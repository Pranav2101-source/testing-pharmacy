package com.checkup.pharmacy.modules.supplier;

import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.tax.IndianState;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.common.util.StableSort;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNote;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNoteRepository;
import com.checkup.pharmacy.modules.purchase.PurchaseOrder;
import com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository;
import com.checkup.pharmacy.modules.supplier.dto.SupplierHistoryResponse;
import com.checkup.pharmacy.modules.supplier.dto.SupplierListResponse;
import com.checkup.pharmacy.modules.supplier.dto.SupplierRequest;
import com.checkup.pharmacy.modules.supplier.dto.SupplierResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Supplier master data, scoped to the caller's pharmacy. */
@Service
public class SupplierService {

    private static final int RECENT_ORDERS_LIMIT = 20;
    private static final int RECENT_GRNS_LIMIT = 10;

    private final SupplierRepository supplierRepository;
    private final PurchaseOrderRepository purchaseOrderRepository;
    private final GoodsReceiptNoteRepository grnRepository;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public SupplierService(SupplierRepository supplierRepository, PurchaseOrderRepository purchaseOrderRepository,
                           GoodsReceiptNoteRepository grnRepository,
                           com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.supplierRepository = supplierRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.grnRepository = grnRepository;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional(readOnly = true)
    public SupplierListResponse list(String search, Boolean isActive, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 200);
        PageRequest pageRequest = PageRequest.of(safePage - 1, safeLimit, StableSort.of(Sort.by("name").ascending()));

        Page<Supplier> result = supplierRepository.search(
                TenantContext.pharmacyId(), blankToNull(search), isActive, pageRequest);

        Map<String, Long> poCounts = poCounts(result.getContent().stream().map(Supplier::getId).toList());
        var items = result.getContent().stream()
                .map(s -> toResponse(s, poCounts.getOrDefault(s.getId(), 0L))).toList();
        return new SupplierListResponse(items, result.getTotalElements(), safePage, result.getTotalPages());
    }

    /** Unpaginated, active-only — for simple picker dropdowns (e.g. quotation creation). */
    @Transactional(readOnly = true)
    public List<SupplierResponse> listAllActive() {
        List<Supplier> suppliers = supplierRepository.findAllActiveByPharmacyId(TenantContext.pharmacyId());
        Map<String, Long> poCounts = poCounts(suppliers.stream().map(Supplier::getId).toList());
        return suppliers.stream().map(s -> toResponse(s, poCounts.getOrDefault(s.getId(), 0L))).toList();
    }

    /**
     * Reject a state this system cannot compare, and a GSTIN that contradicts it.
     *
     * <p>Free text made the interstate comparison unreliable in both directions: one live
     * record held {@code "cjd9949"} as a state, another {@code "karnataka"} beside a GSTIN
     * whose code said Chhattisgarh. Neither is something a tax decision can be based on, and
     * neither was caught at the point it was typed.
     *
     * <p>The GSTIN check runs only when a GSTIN is present and well-formed — an absent one is
     * legitimate for an unregistered supplier, and a malformed one is reported as malformed
     * rather than used to second-guess the state.
     */
    private void validateTaxIdentity(SupplierRequest req) {
        IndianState state = IndianState.fromName(req.state())
                .orElseThrow(() -> new BadRequestException("\"" + req.state().trim()
                        + "\" is not a recognised Indian state or union territory. Pick the state from "
                        + "the list — it decides whether purchases from this supplier attract IGST."));

        String gstin = req.gstin() == null ? null : req.gstin().trim();
        if (gstin == null || gstin.isEmpty()) {
            return;
        }
        if (!gstin.matches(IndianState.GSTIN_PATTERN)) {
            throw new BadRequestException("\"" + gstin + "\" is not a valid GSTIN. A GSTIN is "
                    + IndianState.GSTIN_LENGTH + " characters, starting with a two-digit state code.");
        }
        IndianState fromGstin = IndianState.fromGstin(gstin).orElseThrow(() ->
                new BadRequestException("The GSTIN starts with \"" + gstin.substring(0, 2)
                        + "\", which is not a valid GST state code."));
        if (fromGstin != state) {
            // The GSTIN wins on authority, but we refuse rather than silently overwrite: one of
            // the two is wrong and only the person entering it knows which.
            throw new BadRequestException("This GSTIN belongs to " + fromGstin.displayName()
                    + ", but the state is set to " + state.displayName()
                    + ". Correct whichever is wrong — they must agree.");
        }
    }

    @Transactional
    public SupplierResponse create(SupplierRequest req) {
        validateTaxIdentity(req);
        duplicateSubmitGuard.guard("supplier.create", req);
        Supplier supplier = Supplier.create(TenantContext.pharmacyId(), req.name().trim());
        applyRequest(supplier, req);
        supplierRepository.save(supplier);
        return toResponse(supplier, 0L);
    }

    @Transactional
    public SupplierResponse update(String id, SupplierRequest req) {
        validateTaxIdentity(req);
        Supplier supplier = load(id);
        applyRequest(supplier, req);
        return toResponse(supplier, poCounts(List.of(id)).getOrDefault(id, 0L));
    }

    /** Recent orders/receipts plus lifetime confirmed-GRN spend for one supplier. */
    @Transactional(readOnly = true)
    public SupplierHistoryResponse getHistory(String id) {
        String pharmacyId = TenantContext.pharmacyId();
        load(id); // 404s if the supplier doesn't exist / isn't this pharmacy's

        Page<PurchaseOrder> orders = purchaseOrderRepository.search(pharmacyId, false, List.of("_"), null, id,
                DateRange.MIN, DateRange.MAX, null, PageRequest.of(0, RECENT_ORDERS_LIMIT));
        List<SupplierHistoryResponse.Order> orderItems = orders.getContent().stream()
                .map(po -> new SupplierHistoryResponse.Order(po.getId(), po.getOrderNumber(), po.getStatus().name(),
                        po.getTotalAmount(), po.getOrderedAt(), new SupplierHistoryResponse.ItemCount(po.getItemCount())))
                .toList();

        Page<GoodsReceiptNote> grns = grnRepository.search(pharmacyId, null, id, false, java.time.Instant.now(),
                DateRange.MIN, DateRange.MAX, PageRequest.of(0, RECENT_GRNS_LIMIT));
        List<SupplierHistoryResponse.Grn> grnItems = grns.getContent().stream()
                .map(g -> new SupplierHistoryResponse.Grn(g.getId(), g.getGrnNumber(), g.getStatus().name(),
                        g.getTotalAmount(), g.getCreatedAt()))
                .toList();

        BigDecimal totalSpend = grnRepository.sumConfirmedForSupplier(pharmacyId, id);
        SupplierHistoryResponse.Summary summary = new SupplierHistoryResponse.Summary(orders.getTotalElements(), totalSpend);

        return new SupplierHistoryResponse(new SupplierHistoryResponse.Orders(orderItems), grnItems, summary);
    }

    private Map<String, Long> poCounts(List<String> supplierIds) {
        if (supplierIds.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> counts = new HashMap<>();
        for (PurchaseOrderRepository.SupplierPoCountRow row
                : purchaseOrderRepository.countBySupplierIdIn(TenantContext.pharmacyId(), supplierIds)) {
            counts.put(row.getSupplierId(), row.getTotal());
        }
        return counts;
    }

    private void applyRequest(Supplier supplier, SupplierRequest req) {
        supplier.applyFields(
                req.name().trim(),
                blankToNull(req.gstin()),
                blankToNull(req.dlNumber()),
                // @IndianMobile accepts a pasted "+91 98765 43210"; the column stores the
                // bare 10 digits so one distributor cannot exist under two spellings.
                blankToNull(ValidationPatterns.normalizeMobile(req.phone())),
                blankToNull(req.email()),
                blankToNull(req.address()),
                blankToNull(req.city()),
                blankToNull(req.state()),
                req.creditLimit() == null ? BigDecimal.ZERO : req.creditLimit(),
                req.creditDays() == null ? 30 : req.creditDays(),
                blankToNull(req.paymentTerms()));
    }

    private Supplier load(String id) {
        return supplierRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private SupplierResponse toResponse(Supplier s, long purchaseOrderCount) {
        return SupplierResponse.withPoCount(
                s.getId(), s.getName(), s.getGstin(), s.getDlNumber(), s.getPhone(), s.getEmail(),
                s.getAddress(), s.getCity(), s.getState(), s.getCreditLimit(), s.getCreditDays(),
                s.getPaymentTerms(), s.isActive(), s.getLedgerBalance(), purchaseOrderCount);
    }
}
