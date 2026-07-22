package com.checkup.pharmacy.modules.supplier;

import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.DateRange;
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
        PageRequest pageRequest = PageRequest.of(safePage - 1, safeLimit, Sort.by("name").ascending());

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

    @Transactional
    public SupplierResponse create(SupplierRequest req) {
        duplicateSubmitGuard.guard("supplier.create", req);
        Supplier supplier = Supplier.create(TenantContext.pharmacyId(), req.name().trim());
        applyRequest(supplier, req);
        supplierRepository.save(supplier);
        return toResponse(supplier, 0L);
    }

    @Transactional
    public SupplierResponse update(String id, SupplierRequest req) {
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
                blankToNull(req.phone()),
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
                s.getPaymentTerms(), s.isActive(), purchaseOrderCount);
    }
}
