package com.checkup.pharmacy.modules.quotation;

import com.checkup.pharmacy.common.enums.ApprovalStatus;
import com.checkup.pharmacy.common.enums.QuotationStatus;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.common.util.GstCalculator;
import com.checkup.pharmacy.modules.purchase.PurchaseOrder;
import com.checkup.pharmacy.modules.purchase.PurchaseOrderItemSnapshot;
import com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderResponse;
import com.checkup.pharmacy.modules.quotation.dto.CompareQuotationsResponse;
import com.checkup.pharmacy.modules.quotation.dto.ConvertToPoResponse;
import com.checkup.pharmacy.modules.quotation.dto.CreateQuotationRequest;
import com.checkup.pharmacy.modules.quotation.dto.QuotationItemRequest;
import com.checkup.pharmacy.modules.quotation.dto.QuotationPageResponse;
import com.checkup.pharmacy.modules.quotation.dto.QuotationResponse;
import com.checkup.pharmacy.modules.quotation.dto.UpdateQuotationRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Requests for quotation (RFQ) sent to suppliers, scoped to the caller's
 * pharmacy — lets a pharmacy compare prices across suppliers for the same
 * medicines before raising a purchase order. {@link #convertToPo} builds a
 * DRAFT {@link PurchaseOrder} directly from a RECEIVED quotation's items,
 * reusing C12's purchase-order entity and numbering rather than duplicating it.
 */
@Service
public class QuotationService {

    private final QuotationRepository quotationRepository;
    private final QuotationItemRepository itemRepository;
    private final SupplierRepository supplierRepository;
    private final PurchaseOrderRepository purchaseOrderRepository;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public QuotationService(QuotationRepository quotationRepository, QuotationItemRepository itemRepository,
                            SupplierRepository supplierRepository, PurchaseOrderRepository purchaseOrderRepository,
                            DocumentSequenceService sequenceService,
                            com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.quotationRepository = quotationRepository;
        this.itemRepository = itemRepository;
        this.supplierRepository = supplierRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.sequenceService = sequenceService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional
    public QuotationResponse create(CreateQuotationRequest req) {
        duplicateSubmitGuard.guard("quotation.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        Supplier supplier = loadSupplier(req.supplierId());

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.QUOTATION);
        Quotation quotation = Quotation.create(pharmacyId, supplier.getId(), DocumentNumberFormat.quotation(seq),
                TenantContext.userId(), req.validUntil(), req.notes());
        quotationRepository.save(quotation);

        List<QuotationItem> items = req.items().stream()
                .map(i -> QuotationItem.create(pharmacyId, quotation.getId(), i.medicineId(), i.medicineName(),
                        i.quantity(), i.quotedRate(), i.mrp(), i.gstRateOrDefault(), i.discountOrZero(), i.notes()))
                .toList();
        itemRepository.saveAll(items);

        return toResponse(quotation, supplier, items);
    }

    @Transactional
    public QuotationResponse update(String id, UpdateQuotationRequest req) {
        Quotation quotation = load(id);
        if (quotation.getStatus() != QuotationStatus.DRAFT && quotation.getStatus() != QuotationStatus.SENT) {
            throw new ConflictException("Only DRAFT or SENT quotations can be updated (current status: " + quotation.getStatus() + ")");
        }
        quotation.applyDraft(req.validUntil() != null ? req.validUntil() : quotation.getValidUntil(),
                req.notes() != null ? req.notes() : quotation.getNotes());

        List<QuotationItem> items;
        if (req.items() != null) {
            if (req.items().isEmpty()) {
                throw new BadRequestException("items must not be empty");
            }
            itemRepository.deleteByQuotationId(id);
            items = req.items().stream()
                    .map(i -> QuotationItem.create(quotation.getPharmacyId(), id, i.medicineId(), i.medicineName(),
                            i.quantity(), i.quotedRate(), i.mrp(), i.gstRateOrDefault(), i.discountOrZero(), i.notes()))
                    .toList();
            itemRepository.saveAll(items);
        } else {
            items = itemRepository.findByQuotationId(id);
        }

        return toResponse(quotation, loadSupplier(quotation.getSupplierId()), items);
    }

    @Transactional
    public QuotationResponse markSent(String id) {
        Quotation quotation = load(id);
        if (quotation.getStatus() != QuotationStatus.DRAFT) {
            throw new ConflictException("Only a DRAFT quotation can be sent (current status: " + quotation.getStatus() + ")");
        }
        quotation.changeStatus(QuotationStatus.SENT);
        return toResponse(quotation, loadSupplier(quotation.getSupplierId()), itemRepository.findByQuotationId(id));
    }

    @Transactional
    public QuotationResponse markReceived(String id) {
        Quotation quotation = load(id);
        if (quotation.getStatus() != QuotationStatus.SENT) {
            throw new ConflictException("Only a SENT quotation can be marked RECEIVED (current status: " + quotation.getStatus() + ")");
        }
        quotation.changeStatus(QuotationStatus.RECEIVED);
        return toResponse(quotation, loadSupplier(quotation.getSupplierId()), itemRepository.findByQuotationId(id));
    }

    @Transactional
    public QuotationResponse markExpired(String id) {
        Quotation quotation = load(id);
        if (quotation.getStatus() != QuotationStatus.DRAFT && quotation.getStatus() != QuotationStatus.SENT) {
            throw new ConflictException("Only a DRAFT or SENT quotation can expire (current status: " + quotation.getStatus() + ")");
        }
        quotation.changeStatus(QuotationStatus.EXPIRED);
        return toResponse(quotation, loadSupplier(quotation.getSupplierId()), itemRepository.findByQuotationId(id));
    }

    @Transactional(readOnly = true)
    public QuotationResponse getById(String id) {
        Quotation quotation = load(id);
        return toResponse(quotation, quotation.getSupplier(), itemRepository.findByQuotationId(id));
    }

    @Transactional(readOnly = true)
    public QuotationPageResponse list(String supplierId, String status, Instant from, Instant to, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<Quotation> result = quotationRepository.search(TenantContext.pharmacyId(), blankToNull(supplierId),
                blankToNull(status), DateRange.from(from), DateRange.to(to), PageRequest.of(safePage - 1, safeLimit));

        List<QuotationResponse> items = result.getContent().stream()
                .map(q -> toResponse(q, q.getSupplier(), itemRepository.findByQuotationId(q.getId())))
                .toList();
        return new QuotationPageResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    @Transactional(readOnly = true)
    public CompareQuotationsResponse compare(List<String> quotationIds) {
        String pharmacyId = TenantContext.pharmacyId();
        List<Quotation> quotations = quotationRepository.findByIdInAndPharmacyId(quotationIds, pharmacyId);
        if (quotations.size() != quotationIds.size()) {
            throw new NotFoundException("One or more quotations not found");
        }

        Map<String, List<QuotationItem>> itemsByQuotation = new HashMap<>();
        for (QuotationItem item : itemRepository.findByQuotationIdIn(quotationIds)) {
            itemsByQuotation.computeIfAbsent(item.getQuotationId(), k -> new ArrayList<>()).add(item);
        }

        record RawQuote(String quotationId, Supplier supplier, QuotationItem item, BigDecimal effectiveRate) {
        }
        Map<String, List<RawQuote>> byMedicine = new LinkedHashMap<>();
        Map<String, String> medicineNames = new HashMap<>();

        for (Quotation q : quotations) {
            for (QuotationItem item : itemsByQuotation.getOrDefault(q.getId(), List.of())) {
                BigDecimal effectiveRate = item.getQuotedRate() == null ? null
                        : GstCalculator.round2(item.getQuotedRate().multiply(
                                BigDecimal.ONE.subtract(item.getDiscount().divide(BigDecimal.valueOf(100), 10, java.math.RoundingMode.HALF_UP))));
                byMedicine.computeIfAbsent(item.getMedicineId(), k -> new ArrayList<>())
                        .add(new RawQuote(q.getId(), q.getSupplier(), item, effectiveRate));
                medicineNames.putIfAbsent(item.getMedicineId(), item.getMedicineName());
            }
        }

        List<CompareQuotationsResponse.MedicineComparison> comparison = new ArrayList<>();
        for (Map.Entry<String, List<RawQuote>> entry : byMedicine.entrySet()) {
            BigDecimal bestRate = entry.getValue().stream()
                    .map(RawQuote::effectiveRate).filter(r -> r != null)
                    .min(BigDecimal::compareTo).orElse(null);

            List<CompareQuotationsResponse.Quote> quotes = entry.getValue().stream()
                    .map(rq -> new CompareQuotationsResponse.Quote(rq.quotationId(), rq.supplier().getId(),
                            rq.supplier().getName(), rq.item().getQuantity(), rq.item().getQuotedRate(), rq.item().getMrp(),
                            rq.item().getGstRate(), rq.item().getDiscount(), rq.effectiveRate(),
                            rq.effectiveRate() != null && bestRate != null && rq.effectiveRate().compareTo(bestRate) == 0))
                    .toList();

            comparison.add(new CompareQuotationsResponse.MedicineComparison(entry.getKey(), medicineNames.get(entry.getKey()), bestRate, quotes));
        }

        List<CompareQuotationsResponse.QuotationRef> quotationRefs = quotations.stream()
                .map(q -> new CompareQuotationsResponse.QuotationRef(q.getId(), q.getQuotationNumber(),
                        new CompareQuotationsResponse.SupplierRef(q.getSupplier().getId(), q.getSupplier().getName())))
                .toList();

        return new CompareQuotationsResponse(quotationRefs, comparison);
    }

    @Transactional
    public ConvertToPoResponse convertToPo(String id, String notes) {
        // Locking load, not load(): the RECEIVED check below guards the creation of a
        // purchase order, and unlocked it is a check-then-act that lets a double-click
        // raise two orders for the same goods. See lockByIdAndPharmacyId.
        Quotation quotation = quotationRepository.lockByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Quotation not found"));
        if (quotation.getStatus() != QuotationStatus.RECEIVED) {
            throw new ConflictException("Only RECEIVED quotations can be converted to a purchase order (current status: " + quotation.getStatus() + ")");
        }
        List<QuotationItem> items = itemRepository.findByQuotationId(id);
        List<QuotationItem> missingRates = items.stream().filter(i -> i.getQuotedRate() == null || i.getQuotedRate().compareTo(BigDecimal.ZERO) <= 0).toList();
        if (!missingRates.isEmpty()) {
            throw new UnprocessableEntityException(missingRates.size() + " item(s) have no quoted rate — update the quotation before converting.");
        }

        String pharmacyId = quotation.getPharmacyId();
        Instant placeholderExpiry = Instant.now().plus(365, ChronoUnit.DAYS);

        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal totalGst = BigDecimal.ZERO;
        List<PurchaseOrderItemSnapshot> snapshots = new ArrayList<>();
        for (QuotationItem item : items) {
            GstCalculator.PurchaseLineGst gst = GstCalculator.calcPurchaseLineGst(item.getQuotedRate(), item.getQuantity(),
                    item.getDiscount(), item.getGstRate());
            subtotal = subtotal.add(gst.lineTotal());
            totalGst = totalGst.add(gst.totalGst());
            BigDecimal mrp = item.getMrp() != null ? item.getMrp() : GstCalculator.round2(item.getQuotedRate().multiply(new BigDecimal("1.3")));
            snapshots.add(new PurchaseOrderItemSnapshot(item.getMedicineId(), item.getMedicineName(), "TBD",
                    placeholderExpiry.toString(), item.getQuantity(), item.getQuotedRate(), mrp, item.getGstRate(),
                    gst.cgst(), gst.sgst(), gst.amount()));
        }

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.PURCHASE_ORDER);
        String orderNumber = DocumentNumberFormat.purchaseOrder(seq);
        String poNotes = notes != null && !notes.isBlank() ? notes : "Converted from quotation " + quotation.getQuotationNumber();

        PurchaseOrder po = PurchaseOrder.create(pharmacyId, quotation.getSupplierId(), orderNumber, ApprovalStatus.NOT_REQUIRED);
        po.applyDraft(null, poNotes, null, snapshots, subtotal, totalGst);
        purchaseOrderRepository.save(po);

        quotation.changeStatus(QuotationStatus.CONVERTED);

        Supplier supplier = loadSupplier(quotation.getSupplierId());
        PurchaseOrderResponse.SupplierRef supplierRef = new PurchaseOrderResponse.SupplierRef(supplier.getId(), supplier.getName(), supplier.getPhone(), supplier.getEmail());
        List<PurchaseOrderResponse.ItemSnapshot> itemResponses = snapshots.stream()
                .map(s -> new PurchaseOrderResponse.ItemSnapshot(s.medicineId(), s.medicineName(), s.batchNumber(),
                        s.expiryDate(), s.quantity(), s.purchaseRate(), s.mrp(), s.gstRate(), s.cgst(), s.sgst(), s.amount()))
                .toList();
        PurchaseOrderResponse poResponse = new PurchaseOrderResponse(po.getId(), po.getOrderNumber(), supplierRef,
                po.getInvoiceNo(), po.getStatus().name(), po.getApprovalStatus().name(), po.getApprovedBy(), po.getApprovedAt(),
                po.getRejectionReason(), po.getSubtotal(), po.getTotalGst(), po.getTotalAmount(), po.getNotes(),
                po.getExpectedDate(), po.getOrderedAt(), po.getReceivedAt(), itemResponses, po.getItemCount(), List.of(),
                po.getSourceUploadId());

        return new ConvertToPoResponse(quotation.getId(), quotation.getQuotationNumber(), quotation.getStatus().name(), poResponse);
    }

    private Quotation load(String id) {
        return quotationRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Quotation not found"));
    }

    private Supplier loadSupplier(String id) {
        return supplierRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private QuotationResponse toResponse(Quotation q, Supplier supplier, List<QuotationItem> items) {
        QuotationResponse.SupplierRef supplierRef = supplier == null ? null
                : new QuotationResponse.SupplierRef(supplier.getId(), supplier.getName(), supplier.getPhone(), supplier.getEmail());
        List<QuotationResponse.Item> itemResponses = items.stream()
                .map(i -> new QuotationResponse.Item(i.getId(), i.getMedicineId(), i.getMedicineName(), i.getQuantity(),
                        i.getQuotedRate(), i.getMrp(), i.getGstRate(), i.getDiscount(), i.getNotes()))
                .toList();
        return new QuotationResponse(q.getId(), q.getQuotationNumber(), supplierRef, q.getStatus().name(), q.getValidUntil(),
                q.getNotes(), itemResponses, items.size(), q.getCreatedAt(), q.getUpdatedAt());
    }
}
