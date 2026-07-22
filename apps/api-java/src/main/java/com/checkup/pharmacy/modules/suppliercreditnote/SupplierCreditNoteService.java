package com.checkup.pharmacy.modules.suppliercreditnote;

import com.checkup.pharmacy.common.enums.CreditNoteStatus;
import com.checkup.pharmacy.common.enums.SupplierReturnStatus;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreateCreditNoteRequest;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreditNotePageResponse;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.CreditNoteResponse;
import com.checkup.pharmacy.modules.suppliercreditnote.dto.UpdateCreditNoteStatusRequest;
import com.checkup.pharmacy.modules.supplierledger.SupplierLedgerEntry;
import com.checkup.pharmacy.modules.supplierledger.SupplierLedgerEntryRepository;
import com.checkup.pharmacy.modules.supplierreturn.SupplierReturn;
import com.checkup.pharmacy.modules.supplierreturn.SupplierReturnRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * Credit notes issued by a supplier, scoped to the caller's pharmacy. Stored in
 * the shared {@link SupplierLedgerEntry} table (type = CREDIT_NOTE).
 *
 * <p>Whether marking one APPLIED touches {@link Supplier#getLedgerBalance()}
 * depends on where the credit came from:
 * <ul>
 *   <li>Raised against a {@link SupplierReturn}: no adjustment here — that
 *       return's own {@code confirm()} already decremented the balance when the
 *       return was confirmed. Double-adjusting would count the same credit twice.
 *   <li>Standalone (no linked return — e.g. a pricing correction the supplier
 *       credits with no physical return involved): applying it here IS the one
 *       point that reduces what the pharmacy owes, since nothing else in the
 *       system has adjusted the balance for it.
 * </ul>
 * Both cases require the OWNER role ({@code @PreAuthorize} on the controller) to
 * transition status — that is this flow's approval gate, matching the other
 * ledger-affecting purchase-side flows (GRN confirm, supplier return confirm).
 */
@Service
public class SupplierCreditNoteService {

    private final SupplierLedgerEntryRepository ledgerRepository;
    private final SupplierRepository supplierRepository;
    private final SupplierReturnRepository supplierReturnRepository;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public SupplierCreditNoteService(SupplierLedgerEntryRepository ledgerRepository, SupplierRepository supplierRepository,
                                     SupplierReturnRepository supplierReturnRepository, DocumentSequenceService sequenceService,
                                     com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.ledgerRepository = ledgerRepository;
        this.supplierRepository = supplierRepository;
        this.supplierReturnRepository = supplierReturnRepository;
        this.sequenceService = sequenceService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional
    public CreditNoteResponse create(CreateCreditNoteRequest req) {
        duplicateSubmitGuard.guard("supplier.creditnote.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        Supplier supplier = supplierRepository.findByIdAndPharmacyId(req.supplierId(), pharmacyId)
                .orElseThrow(() -> new NotFoundException("Supplier not found"));

        SupplierReturn supplierReturn = null;
        if (req.supplierReturnId() != null && !req.supplierReturnId().isBlank()) {
            supplierReturn = supplierReturnRepository.findByIdAndPharmacyId(req.supplierReturnId(), pharmacyId)
                    .filter(r -> r.getSupplierId().equals(supplier.getId()) && r.getStatus() == SupplierReturnStatus.CONFIRMED)
                    .orElseThrow(() -> new NotFoundException("Confirmed supplier return not found for this supplier"));
        }

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.SUPPLIER_CREDIT_NOTE, DocumentSequenceService.PERIOD_ALL);
        SupplierLedgerEntry entry = SupplierLedgerEntry.createCreditNote(pharmacyId, supplier.getId(),
                DocumentNumberFormat.supplierCreditNote(seq), req.amount(),
                supplierReturn == null ? null : supplierReturn.getId(), req.reference(), req.notes(), req.issuedAt(),
                TenantContext.userId());
        ledgerRepository.save(entry);

        return toResponse(entry, supplier, supplierReturn);
    }

    @Transactional
    public CreditNoteResponse updateStatus(String id, UpdateCreditNoteStatusRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        SupplierLedgerEntry entry = ledgerRepository.lockCreditNoteByIdAndPharmacyId(id, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Credit note not found"));
        if (entry.getStatus() != CreditNoteStatus.PENDING) {
            throw new ConflictException("Credit note is already " + entry.getStatus());
        }
        CreditNoteStatus newStatus;
        try {
            newStatus = CreditNoteStatus.valueOf(req.status());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("status must be APPLIED or CANCELLED");
        }
        if (newStatus == CreditNoteStatus.PENDING) {
            throw new BadRequestException("status must be APPLIED or CANCELLED");
        }
        entry.updateCreditNoteStatus(newStatus, req.notes());

        // A credit note raised against a supplier return never adjusts the ledger here —
        // SupplierReturnsService.confirm() already decremented it when the return itself
        // was confirmed; double-adjusting would count the same credit twice. A standalone
        // note has no such prior adjustment anywhere else in the system, so applying it is
        // the one point that actually reduces what the pharmacy owes.
        Supplier supplier;
        if (newStatus == CreditNoteStatus.APPLIED && entry.getSupplierReturnId() == null) {
            // Locked after the credit note's own row lock above, keeping lock order
            // document-then-supplier, same as PurchasesService.confirmGrn /
            // SupplierReturnsService.confirm.
            supplier = supplierRepository.lockByIdAndPharmacyId(entry.getSupplierId(), pharmacyId)
                    .orElseThrow(() -> new NotFoundException("Supplier not found"));
            supplier.adjustLedgerBalance(entry.getAmount().negate());
        } else {
            supplier = supplierRepository.findByIdAndPharmacyId(entry.getSupplierId(), pharmacyId).orElse(null);
        }

        SupplierReturn supplierReturn = entry.getSupplierReturnId() == null ? null
                : supplierReturnRepository.findById(entry.getSupplierReturnId()).orElse(null);
        return toResponse(entry, supplier, supplierReturn);
    }

    @Transactional(readOnly = true)
    public CreditNoteResponse getById(String id) {
        SupplierLedgerEntry entry = ledgerRepository.findCreditNoteByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Credit note not found"));
        SupplierReturn supplierReturn = entry.getSupplierReturnId() == null ? null
                : supplierReturnRepository.findById(entry.getSupplierReturnId()).orElse(null);
        return toResponse(entry, entry.getSupplier(), supplierReturn);
    }

    @Transactional(readOnly = true)
    public CreditNotePageResponse list(String supplierId, String status, Instant from, Instant to, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        String pharmacyId = TenantContext.pharmacyId();
        Page<SupplierLedgerEntry> result = ledgerRepository.searchCreditNotes(pharmacyId, blankToNull(supplierId),
                blankToNull(status), DateRange.from(from), DateRange.to(to), PageRequest.of(safePage - 1, safeLimit));

        List<CreditNoteResponse> items = result.getContent().stream()
                .map(e -> toResponse(e, e.getSupplier(), null)).toList();
        return new CreditNotePageResponse(items, result.getTotalElements(), safePage, safeLimit,
                ledgerRepository.sumPendingCreditNotes(pharmacyId));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private CreditNoteResponse toResponse(SupplierLedgerEntry entry, Supplier supplier, SupplierReturn supplierReturn) {
        CreditNoteResponse.SupplierRef supplierRef = supplier == null ? null
                : new CreditNoteResponse.SupplierRef(supplier.getId(), supplier.getName(), supplier.getPhone());
        CreditNoteResponse.SupplierReturnRef returnRef = supplierReturn == null ? null
                : new CreditNoteResponse.SupplierReturnRef(supplierReturn.getId(), supplierReturn.getReturnNumber(), supplierReturn.getTotalAmount());
        return new CreditNoteResponse(entry.getId(), entry.getEntryNumber(), supplierRef, returnRef, entry.getAmount(),
                entry.getStatus() == null ? null : entry.getStatus().name(), entry.getReference(), entry.getNotes(),
                entry.getIssuedAt(), entry.getCreatedAt());
    }
}
