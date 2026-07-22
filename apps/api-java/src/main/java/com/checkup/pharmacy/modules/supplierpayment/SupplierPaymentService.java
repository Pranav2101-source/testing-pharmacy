package com.checkup.pharmacy.modules.supplierpayment;

import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.projection.SupplierAmountRow;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNote;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNoteRepository;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.supplierledger.SupplierLedgerEntry;
import com.checkup.pharmacy.modules.supplierledger.SupplierLedgerEntryRepository;
import com.checkup.pharmacy.modules.supplierpayment.dto.CreatePaymentRequest;
import com.checkup.pharmacy.modules.supplierpayment.dto.OutstandingResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.PaymentPageResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.PaymentResponse;
import com.checkup.pharmacy.modules.supplierpayment.dto.SupplierBalanceResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Money paid to a supplier, scoped to the caller's pharmacy. Stored in the
 * shared {@link SupplierLedgerEntry} table (type = PAYMENT) — see that class's
 * javadoc for why. Every create decrements {@link Supplier#getLedgerBalance()}.
 */
@Service
public class SupplierPaymentService {

    private final SupplierLedgerEntryRepository ledgerRepository;
    private final SupplierRepository supplierRepository;
    private final GoodsReceiptNoteRepository grnRepository;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public SupplierPaymentService(SupplierLedgerEntryRepository ledgerRepository, SupplierRepository supplierRepository,
                                  GoodsReceiptNoteRepository grnRepository, DocumentSequenceService sequenceService,
                                  com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.ledgerRepository = ledgerRepository;
        this.supplierRepository = supplierRepository;
        this.grnRepository = grnRepository;
        this.sequenceService = sequenceService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional
    public PaymentResponse create(CreatePaymentRequest req) {
        duplicateSubmitGuard.guard("supplier.payment.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        // Locking load: this method adjusts the supplier's running ledger balance, a
        // read-modify-write that two concurrent payments would otherwise interleave,
        // losing one of them silently. See SupplierRepository#lockByIdAndPharmacyId.
        Supplier supplier = supplierRepository.lockByIdAndPharmacyId(req.supplierId(), pharmacyId)
                .orElseThrow(() -> new NotFoundException("Supplier not found"));

        GoodsReceiptNote grn = null;
        if (req.grnId() != null && !req.grnId().isBlank()) {
            grn = grnRepository.findByIdAndPharmacyId(req.grnId(), pharmacyId)
                    .filter(g -> g.getSupplierId().equals(supplier.getId()))
                    .orElseThrow(() -> new NotFoundException("GRN not found for this supplier"));
        }

        PaymentMode mode;
        try {
            mode = PaymentMode.valueOf(req.paymentMode());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("paymentMode must be one of CASH, UPI, CARD, CREDIT, WALLET");
        }

        // "ALL" period — this counter never resets by financial year, only the year label in the number changes.
        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.SUPPLIER_PAYMENT, DocumentSequenceService.PERIOD_ALL);
        SupplierLedgerEntry entry = SupplierLedgerEntry.createPayment(pharmacyId, supplier.getId(),
                DocumentNumberFormat.supplierPayment(seq), req.amount(), grn == null ? null : grn.getId(), mode,
                blankToNull(req.reference()), req.notes(), req.paidAt(), TenantContext.userId());
        ledgerRepository.save(entry);

        supplier.adjustLedgerBalance(req.amount().negate());

        return toResponse(entry, supplier, grn);
    }

    @Transactional(readOnly = true)
    public PaymentResponse getById(String id) {
        SupplierLedgerEntry entry = ledgerRepository.findPaymentByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Payment not found"));
        GoodsReceiptNote grn = entry.getGrnId() == null ? null : grnRepository.findById(entry.getGrnId()).orElse(null);
        return toResponse(entry, entry.getSupplier(), grn);
    }

    @Transactional(readOnly = true)
    public PaymentPageResponse list(String supplierId, String grnId, Instant from, Instant to, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<SupplierLedgerEntry> result = ledgerRepository.searchPayments(TenantContext.pharmacyId(),
                blankToNull(supplierId), blankToNull(grnId), DateRange.from(from), DateRange.to(to),
                PageRequest.of(safePage - 1, safeLimit));

        List<PaymentResponse> items = result.getContent().stream()
                .map(e -> toResponse(e, e.getSupplier(), null)).toList();
        return new PaymentPageResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    /**
     * {@code totalPurchased} and {@code totalPaid} are informational breakdowns —
     * "how much have we bought / paid". {@code outstanding} is the reconciled figure
     * a pharmacy actually pays against, so unlike the other two it must come from
     * {@link Supplier#getLedgerBalance()}, not be re-derived here.
     *
     * <p>This used to compute {@code outstanding} as confirmed-GRNs minus payments,
     * independently of the stored balance. That formula silently drops two things
     * {@code ledgerBalance} already accounts for: supplier returns (which decrement
     * it in {@code SupplierReturnsService.confirm}) and migrated opening balances
     * (which {@code MigrationService} writes directly onto it — a migrated supplier
     * has no GRNs here at all, so the old formula reported such a supplier as owing
     * nothing regardless of what was actually carried over). Two numbers claiming to
     * answer "what do we owe this supplier" that disagreed the moment either applied.
     */
    @Transactional(readOnly = true)
    public SupplierBalanceResponse getSupplierBalance(String supplierId) {
        String pharmacyId = TenantContext.pharmacyId();
        Supplier supplier = supplierRepository.findByIdAndPharmacyId(supplierId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Supplier not found"));

        BigDecimal totalPurchased = grnRepository.sumConfirmedForSupplier(pharmacyId, supplierId);
        BigDecimal totalPaid = ledgerRepository.sumPaymentsForSupplier(pharmacyId, supplierId);
        BigDecimal outstanding = supplier.getLedgerBalance();

        Instant now = Instant.now();
        List<GoodsReceiptNote> overdue = grnRepository.findOverdueForSupplier(pharmacyId, supplierId, now);
        BigDecimal overdueAmount = overdue.stream().map(GoodsReceiptNote::getTotalAmount).reduce(BigDecimal.ZERO, BigDecimal::add);

        List<SupplierBalanceResponse.OverdueGrn> overdueRefs = overdue.stream()
                .map(g -> new SupplierBalanceResponse.OverdueGrn(g.getId(), g.getGrnNumber(), g.getTotalAmount(),
                        g.getPaymentDueDate(), g.getSupplierInvoiceNo()))
                .toList();

        return new SupplierBalanceResponse(
                new SupplierBalanceResponse.SupplierRef(supplier.getId(), supplier.getName(), supplier.getCreditLimit(), supplier.getCreditDays()),
                totalPurchased, totalPaid, outstanding, overdueAmount, overdueRefs,
                supplier.getCreditLimit(), supplier.getCreditDays());
    }

    /**
     * Payables across every supplier — batched via two GROUP BY queries instead of N
     * per-supplier round trips.
     *
     * <p>{@code outstanding} comes from {@link Supplier#getLedgerBalance()}, same as
     * the single-supplier {@link #getSupplierBalance}, not from {@code purchased -
     * paid} — that formula misses supplier returns, migrated opening balances, and
     * applied standalone credit notes, exactly the divergence documented on
     * {@code getSupplierBalance}'s javadoc. {@code totalPurchased}/{@code totalPaid}
     * stay independently computed; they're informational breakdowns, not the figure
     * a pharmacy pays against.
     */
    @Transactional(readOnly = true)
    public OutstandingResponse listOutstanding() {
        String pharmacyId = TenantContext.pharmacyId();
        List<Supplier> suppliers = supplierRepository.findByPharmacyId(pharmacyId);

        Map<String, BigDecimal> purchasedBySupplier = toMap(grnRepository.sumConfirmedBySupplier(pharmacyId));
        Map<String, BigDecimal> paidBySupplier = toMap(ledgerRepository.sumPaymentsBySupplier(pharmacyId));
        Map<String, BigDecimal> overdueBySupplier = toMap(grnRepository.sumOverdueBySupplier(pharmacyId, Instant.now()));

        List<OutstandingResponse.SupplierDue> dues = suppliers.stream()
                .map(s -> {
                    BigDecimal purchased = purchasedBySupplier.getOrDefault(s.getId(), BigDecimal.ZERO);
                    BigDecimal paid = paidBySupplier.getOrDefault(s.getId(), BigDecimal.ZERO);
                    return new OutstandingResponse.SupplierDue(s.getId(), s.getName(), s.getPhone(), s.getCreditDays(),
                            purchased, paid, s.getLedgerBalance(), overdueBySupplier.getOrDefault(s.getId(), BigDecimal.ZERO));
                })
                .filter(d -> d.outstanding().compareTo(BigDecimal.valueOf(0.01)) > 0)
                .sorted((a, b) -> b.outstanding().compareTo(a.outstanding()))
                .toList();

        BigDecimal totalOutstanding = dues.stream().map(OutstandingResponse.SupplierDue::outstanding).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalOverdue = dues.stream().map(OutstandingResponse.SupplierDue::overdueAmount).reduce(BigDecimal.ZERO, BigDecimal::add);

        return new OutstandingResponse(dues, totalOutstanding, totalOverdue, dues.size());
    }

    private Map<String, BigDecimal> toMap(List<SupplierAmountRow> rows) {
        Map<String, BigDecimal> map = new HashMap<>();
        for (SupplierAmountRow r : rows) {
            map.put(r.getSupplierId(), r.getTotal());
        }
        return map;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private PaymentResponse toResponse(SupplierLedgerEntry entry, Supplier supplier, GoodsReceiptNote grn) {
        PaymentResponse.SupplierRef supplierRef = supplier == null ? null
                : new PaymentResponse.SupplierRef(supplier.getId(), supplier.getName());
        PaymentResponse.GrnRef grnRef = grn == null ? null
                : new PaymentResponse.GrnRef(grn.getId(), grn.getGrnNumber(), grn.getTotalAmount());
        return new PaymentResponse(entry.getId(), entry.getEntryNumber(), supplierRef, grnRef, entry.getAmount(),
                entry.getPaymentMode() == null ? null : entry.getPaymentMode().name(), entry.getReference(),
                entry.getNotes(), entry.getPaidAt(), entry.getCreatedAt());
    }
}
