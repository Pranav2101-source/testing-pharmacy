package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.ApprovalStatus;
import com.checkup.pharmacy.common.enums.GRNStatus;
import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.enums.PurchaseStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.ForbiddenException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.common.util.GstCalculator;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovement;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.purchase.dto.ApprovePurchaseOrderRequest;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.CreatePurchaseOrderRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnPageResponse;
import com.checkup.pharmacy.modules.purchase.dto.GrnResponse;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderItemRequest;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderPageResponse;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderResponse;
import com.checkup.pharmacy.modules.purchase.dto.UpdateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.UpdatePurchaseOrderRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Purchase orders and goods-receipt-notes, scoped to the caller's pharmacy.
 * Confirming a GRN is the one flow in this module with real transactional
 * weight: it posts stock, writes the ledger, updates the supplier balance, and
 * rolls the linked PO's status forward — all inside one transaction.
 *
 * Deferred vs. the Node original: PO sharing (email/WhatsApp — needs D4
 * mailer), CSV bulk import (needs uploads/D3).
 * Medicine-name auto-resolution/auto-create is also dropped — callers must
 * supply a valid medicineId, matching every other Tier 1 module's contract.
 */
@Service
public class PurchasesService {

    private static final int NEAR_EXPIRY_DAYS = 90;
    private static final int REORDER_VELOCITY_WINDOW_DAYS = 30;

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final GoodsReceiptNoteRepository grnRepository;
    private final GRNItemRepository grnItemRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository movementRepository;
    private final SupplierRepository supplierRepository;
    private final MedicineRepository medicineRepository;
    private final com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository overrideRepository;
    private final UserRepository userRepository;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public PurchasesService(PurchaseOrderRepository purchaseOrderRepository, GoodsReceiptNoteRepository grnRepository,
                            GRNItemRepository grnItemRepository, InventoryRepository inventoryRepository,
                            InventoryMovementRepository movementRepository, SupplierRepository supplierRepository,
                            MedicineRepository medicineRepository,
                            com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository overrideRepository,
                            UserRepository userRepository, DocumentSequenceService sequenceService,
                            com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.grnRepository = grnRepository;
        this.grnItemRepository = grnItemRepository;
        this.inventoryRepository = inventoryRepository;
        this.movementRepository = movementRepository;
        this.supplierRepository = supplierRepository;
        this.medicineRepository = medicineRepository;
        this.overrideRepository = overrideRepository;
        this.userRepository = userRepository;
        this.sequenceService = sequenceService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    // ── Purchase Orders ──────────────────────────────────────────────────────

    @Transactional
    public PurchaseOrderResponse createPO(CreatePurchaseOrderRequest req) {
        duplicateSubmitGuard.guard("purchase.po.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        Supplier supplier = loadSupplier(req.supplierId());
        validateMedicinesExist(req.items().stream().map(PurchaseOrderItemRequest::medicineId).toList());

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.PURCHASE_ORDER);
        ApprovalStatus approvalStatus = TenantContext.currentUser().role() == Role.OWNER
                ? ApprovalStatus.NOT_REQUIRED : ApprovalStatus.PENDING_APPROVAL;

        PurchaseOrder po = PurchaseOrder.create(pharmacyId, supplier.getId(),
                DocumentNumberFormat.purchaseOrder(seq), approvalStatus);
        applyPoItems(po, req.invoiceNo(), req.notes(), req.expectedDate(), req.items());
        po.setSourceUploadId(req.sourceUploadId());
        purchaseOrderRepository.save(po);

        return toResponse(po, supplier, List.of());
    }

    /**
     * Auto-reorder suggestions — medicines projected to run out within {@code daysThreshold}
     * days, based on trailing 30-day sales velocity. {@code /orders/from-reorder} (the plain
     * {@link #createPO} method, aliased under a different path) turns a selection of these
     * into a DRAFT purchase order.
     */
    @Transactional(readOnly = true)
    public List<com.checkup.pharmacy.modules.purchase.dto.ReorderSuggestionResponse> getReorderSuggestions(int daysThreshold) {
        String pharmacyId = TenantContext.pharmacyId();
        Instant to = Instant.now();
        Instant from = to.minus(REORDER_VELOCITY_WINDOW_DAYS, ChronoUnit.DAYS);

        List<com.checkup.pharmacy.modules.inventory.InventoryMovementRepository.MedicineSalesAggregateRow> sales =
                movementRepository.aggregateSalesByMedicine(pharmacyId, from, to);
        if (sales.isEmpty()) {
            return List.of();
        }

        List<String> medicineIds = sales.stream()
                .map(com.checkup.pharmacy.modules.inventory.InventoryMovementRepository.MedicineSalesAggregateRow::getMedicineId)
                .toList();
        Map<String, List<Inventory>> batchesByMedicine = new HashMap<>();
        for (Inventory inv : inventoryRepository.findByPharmacyIdAndMedicineIdIn(pharmacyId, medicineIds)) {
            batchesByMedicine.computeIfAbsent(inv.getMedicineId(), k -> new ArrayList<>()).add(inv);
        }
        Map<String, com.checkup.pharmacy.modules.medicine.Medicine> medicinesById = new HashMap<>();
        for (com.checkup.pharmacy.modules.medicine.Medicine m : medicineRepository.findAllById(medicineIds)) {
            medicinesById.put(m.getId(), m);
        }
        // Scoped to the medicines in this suggestion set — the unbounded variant read
        // every override the pharmacy had, to use a handful.
        Map<String, BigDecimal> gstOverrideByMedicineId = new HashMap<>();
        if (!medicineIds.isEmpty()) {
            for (var o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medicineIds)) {
                if (o.getGstRate() != null) {
                    gstOverrideByMedicineId.put(o.getMedicineId(), o.getGstRate());
                }
            }
        }

        List<com.checkup.pharmacy.modules.purchase.dto.ReorderSuggestionResponse> suggestions = new ArrayList<>();
        for (var row : sales) {
            String medicineId = row.getMedicineId();
            com.checkup.pharmacy.modules.medicine.Medicine medicine = medicinesById.get(medicineId);
            if (medicine == null) {
                continue;
            }
            List<Inventory> batches = batchesByMedicine.getOrDefault(medicineId, List.of());
            int currentStock = batches.stream()
                    .filter(b -> b.getStatus() == com.checkup.pharmacy.common.enums.BatchStatus.ACTIVE)
                    .mapToInt(Inventory::getQuantity).sum();

            double avgDailySales = Math.round((row.getTotalQuantity() / (double) REORDER_VELOCITY_WINDOW_DAYS) * 10) / 10.0;
            if (avgDailySales <= 0) {
                continue;
            }
            int daysOfStock = (int) Math.floor(currentStock / avgDailySales);
            if (daysOfStock >= daysThreshold) {
                continue;
            }
            int targetStock = (int) Math.ceil(avgDailySales * daysThreshold * 1.5);
            int suggestedQuantity = Math.max(1, targetStock - currentStock);

            // Most recently added batch (any status) — the best available signal for what this
            // medicine last actually cost, even if every batch since sold out or expired.
            Inventory lastBatch = batches.stream()
                    .max(java.util.Comparator.comparing(Inventory::getCreatedAt)).orElse(null);
            int minimumStock = batches.stream()
                    .filter(b -> b.getStatus() == com.checkup.pharmacy.common.enums.BatchStatus.ACTIVE)
                    .findFirst().map(Inventory::getMinimumStock).orElse(0);
            BigDecimal gstRate = gstOverrideByMedicineId.getOrDefault(medicineId, medicine.getGstRate());

            suggestions.add(new com.checkup.pharmacy.modules.purchase.dto.ReorderSuggestionResponse(
                    medicineId, medicine.getName(), currentStock, avgDailySales, daysOfStock, suggestedQuantity,
                    minimumStock, lastBatch == null ? BigDecimal.ZERO : lastBatch.getPurchaseRate(),
                    lastBatch == null ? BigDecimal.ZERO : lastBatch.getMrp(), gstRate));
        }
        return suggestions;
    }

    @Transactional
    public PurchaseOrderResponse updatePO(String id, UpdatePurchaseOrderRequest req) {
        PurchaseOrder po = loadPO(id);
        if (po.getStatus() != PurchaseStatus.DRAFT) {
            throw new ConflictException("Only DRAFT purchase orders can be edited");
        }
        // A field left out of the request means "leave unchanged" (PATCH semantics),
        // not "clear it" — resolve each field against the existing value before writing.
        String invoiceNo = req.invoiceNo() != null ? req.invoiceNo() : po.getInvoiceNo();
        String notes = req.notes() != null ? req.notes() : po.getNotes();
        Instant expectedDate = req.expectedDate() != null ? req.expectedDate() : po.getExpectedDate();

        if (req.items() != null) {
            if (req.items().isEmpty()) {
                throw new BadRequestException("items must not be empty");
            }
            validateMedicinesExist(req.items().stream().map(PurchaseOrderItemRequest::medicineId).toList());
            applyPoItems(po, invoiceNo, notes, expectedDate, req.items());
        } else {
            po.applyDraft(invoiceNo, notes, expectedDate, po.getItems(), po.getSubtotal(), po.getTotalGst());
        }
        return toResponse(po, findGrnRefs(id));
    }

    private void applyPoItems(PurchaseOrder po, String invoiceNo, String notes, Instant expectedDate,
                              List<PurchaseOrderItemRequest> items) {
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal totalGst = BigDecimal.ZERO;
        List<PurchaseOrderItemSnapshot> snapshots = new ArrayList<>();
        Instant placeholderExpiry = Instant.now().plus(365, ChronoUnit.DAYS);

        for (PurchaseOrderItemRequest item : items) {
            GstCalculator.PurchaseLineGst gst = GstCalculator.calcPurchaseLineGst(
                    item.purchaseRateOrZero(), item.quantity(), BigDecimal.ZERO, item.gstRateOrDefault());
            subtotal = subtotal.add(gst.lineTotal());
            totalGst = totalGst.add(gst.totalGst());
            Instant expiry = item.expiryDate() != null ? item.expiryDate() : placeholderExpiry;
            String batch = (item.batchNumber() == null || item.batchNumber().isBlank()) ? "PENDING" : item.batchNumber();
            snapshots.add(new PurchaseOrderItemSnapshot(item.medicineId(), item.medicineName(), batch,
                    expiry.toString(), item.quantity(), item.purchaseRateOrZero(), item.mrpOrZero(),
                    item.gstRateOrDefault(), gst.cgst(), gst.sgst(), gst.amount()));
        }
        po.applyDraft(invoiceNo, notes, expectedDate, snapshots, subtotal, totalGst);
    }

    @Transactional
    public PurchaseOrderResponse approvePO(String id, ApprovePurchaseOrderRequest req) {
        User approver = userRepository.findByIdAndPharmacyId(TenantContext.userId(), TenantContext.pharmacyId())
                .filter(User::isActive)
                .orElseThrow(() -> new ForbiddenException("Approver does not belong to this pharmacy"));

        PurchaseOrder po = loadPO(id);
        if (po.getApprovalStatus() != ApprovalStatus.PENDING_APPROVAL) {
            throw new ConflictException("This purchase order is not pending approval");
        }
        if (Boolean.TRUE.equals(req.approved())) {
            po.approve(approver.getId());
        } else {
            po.reject(approver.getId(), req.rejectionReason());
        }
        return toResponse(po, findGrnRefs(id));
    }

    @Transactional
    public PurchaseOrderResponse sendPO(String id) {
        PurchaseOrder po = loadPO(id);
        if (po.getStatus() != PurchaseStatus.DRAFT) {
            throw new ConflictException("Only DRAFT purchase orders can be sent");
        }
        if (po.getApprovalStatus() == ApprovalStatus.PENDING_APPROVAL) {
            throw new ConflictException("Purchase order is awaiting approval before it can be sent");
        }
        if (po.getApprovalStatus() == ApprovalStatus.REJECTED) {
            throw new ConflictException("Purchase order has been rejected and cannot be sent");
        }
        po.send();
        return toResponse(po, findGrnRefs(id));
    }

    @Transactional
    public PurchaseOrderResponse cancelPO(String id) {
        PurchaseOrder po = loadPO(id);
        if (po.getStatus() == PurchaseStatus.RECEIVED) {
            throw new ConflictException("This order has already been fully received and cannot be cancelled.");
        }
        if (po.getStatus() == PurchaseStatus.CANCELLED) {
            throw new ConflictException("This order is already cancelled.");
        }
        boolean hasConfirmedGrn = !grnRepository.findByPurchaseOrderIdAndStatus(id, GRNStatus.CONFIRMED).isEmpty();
        if (hasConfirmedGrn) {
            throw new UnprocessableEntityException(
                    "This order cannot be cancelled because stock has already been received against it. Cancel the GRN first, then try again.");
        }
        po.cancel();
        return toResponse(po, findGrnRefs(id));
    }

    @Transactional(readOnly = true)
    public PurchaseOrderResponse getPOById(String id) {
        return toResponse(loadPO(id), findGrnRefs(id));
    }

    @Transactional(readOnly = true)
    public PurchaseOrderPageResponse listPOs(List<String> statuses, String approvalStatus, String supplierId,
                                             Instant from, Instant to, String search, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        boolean hasStatus = statuses != null && !statuses.isEmpty();
        Page<PurchaseOrder> result = purchaseOrderRepository.search(TenantContext.pharmacyId(), hasStatus,
                hasStatus ? statuses : List.of("__NONE__"), blankToNull(approvalStatus), blankToNull(supplierId),
                DateRange.from(from), DateRange.to(to), blankToNull(search), PageRequest.of(safePage - 1, safeLimit));

        // List rows carry neither GRN refs nor the line-item snapshots: the list view
        // renders only a header + itemCount, so resolving GRN refs per row (N wasted
        // queries) and serialising every PO's items JSON (wasted payload) both bought
        // nothing. The detail endpoint still returns both.
        List<PurchaseOrderResponse> items = result.getContent().stream()
                .map(this::toPoListResponse).toList();
        return new PurchaseOrderPageResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    // ── GRN ───────────────────────────────────────────────────────────────────

    @Transactional
    public GrnResponse createGrn(CreateGrnRequest req) {
        duplicateSubmitGuard.guard("purchase.grn.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        Supplier supplier = loadSupplier(req.supplierId());
        validateMedicinesExist(req.items().stream().map(GrnItemRequest::medicineId).toList());

        String duplicateWarning = null;
        if (req.supplierInvoiceNo() != null && !req.supplierInvoiceNo().isBlank()) {
            if (!grnRepository.findDuplicateInvoice(pharmacyId, supplier.getId(), req.supplierInvoiceNo(), null).isEmpty()) {
                throw new ConflictException("Supplier invoice \"" + req.supplierInvoiceNo()
                        + "\" is already saved. You may be adding the same delivery twice.");
            }
        } else {
            duplicateWarning = "No supplier invoice number was entered. Without it, we can't detect if this delivery is accidentally added twice.";
        }

        checkNearExpiry(req.items(), req.allowNearExpiry());

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.GRN);
        BigDecimal[] totals = new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO};
        GoodsReceiptNote grn = GoodsReceiptNote.create(pharmacyId, supplier.getId(), blankToNull(req.purchaseOrderId()),
                DocumentNumberFormat.grn(seq), blankToNull(req.supplierInvoiceNo()), req.supplierInvoiceDate(),
                req.notes(), BigDecimal.ZERO, BigDecimal.ZERO);
        grn.setSourceUploadId(req.sourceUploadId());
        grnRepository.save(grn);

        List<GRNItem> items = buildGrnItems(pharmacyId, grn.getId(), req.items(), totals);
        grnItemRepository.saveAll(items);
        grn.applyDraftEdit(grn.getSupplierInvoiceNo(), grn.getSupplierInvoiceDate(), grn.getNotes(), totals[0], totals[1]);

        return toResponse(grn, supplier, items, duplicateWarning);
    }

    @Transactional
    public GrnResponse updateGrn(String id, UpdateGrnRequest req) {
        GoodsReceiptNote grn = loadGrn(id);
        if (grn.getStatus() != GRNStatus.DRAFT) {
            throw new ConflictException("Only GRNs that have not been confirmed yet can be edited.");
        }
        if (req.supplierInvoiceNo() != null && !req.supplierInvoiceNo().isBlank()) {
            if (!grnRepository.findDuplicateInvoice(grn.getPharmacyId(), grn.getSupplierId(), req.supplierInvoiceNo(), id).isEmpty()) {
                throw new ConflictException("Supplier invoice \"" + req.supplierInvoiceNo() + "\" is already recorded on another GRN.");
            }
        }

        List<GRNItem> items;
        BigDecimal subtotal = grn.getSubtotal();
        BigDecimal totalGst = grn.getTotalGst();
        if (req.items() != null) {
            if (req.items().isEmpty()) {
                throw new BadRequestException("items must not be empty");
            }
            validateMedicinesExist(req.items().stream().map(GrnItemRequest::medicineId).toList());
            checkNearExpiry(req.items(), req.allowNearExpiry());
            grnItemRepository.deleteByGrnId(id);
            BigDecimal[] totals = new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO};
            items = buildGrnItems(grn.getPharmacyId(), id, req.items(), totals);
            grnItemRepository.saveAll(items);
            subtotal = totals[0];
            totalGst = totals[1];
        } else {
            items = grnItemRepository.findByGrnId(id);
        }

        grn.applyDraftEdit(blankToNull(req.supplierInvoiceNo()) != null ? req.supplierInvoiceNo() : grn.getSupplierInvoiceNo(),
                req.supplierInvoiceDate() != null ? req.supplierInvoiceDate() : grn.getSupplierInvoiceDate(),
                req.notes() != null ? req.notes() : grn.getNotes(), subtotal, totalGst);

        Supplier supplier = loadSupplier(grn.getSupplierId());
        return toResponse(grn, supplier, items, null);
    }

    private List<GRNItem> buildGrnItems(String pharmacyId, String grnId, List<GrnItemRequest> requests, BigDecimal[] totalsOut) {
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal totalGst = BigDecimal.ZERO;
        List<GRNItem> items = new ArrayList<>();
        for (GrnItemRequest r : requests) {
            GstCalculator.PurchaseLineGst gst = GstCalculator.calcPurchaseLineGst(
                    r.purchaseRate(), r.receivedQty(), r.discountOrZero(), r.gstRate());
            subtotal = subtotal.add(gst.lineTotal());
            totalGst = totalGst.add(gst.totalGst());
            items.add(GRNItem.create(pharmacyId, grnId, r.medicineId(), r.medicineName(), r.batchNumber(),
                    r.expiryDate(), r.orderedQty(), r.receivedQty(), r.freeQtyOrZero(), r.purchaseUnitOrDefault(),
                    r.conversionFactorOrDefault(), r.purchaseRate(), r.mrp(), r.discountOrZero(), r.gstRate(),
                    gst.cgst(), gst.sgst(), gst.amount()));
        }
        totalsOut[0] = subtotal;
        totalsOut[1] = totalGst;
        return items;
    }

    private void checkNearExpiry(List<GrnItemRequest> items, boolean allowNearExpiry) {
        if (allowNearExpiry) {
            return;
        }
        Instant threshold = Instant.now().plus(NEAR_EXPIRY_DAYS, ChronoUnit.DAYS);
        List<String> nearExpiry = items.stream()
                .filter(i -> !i.expiryDate().isAfter(threshold))
                .map(GrnItemRequest::medicineName)
                .toList();
        if (!nearExpiry.isEmpty()) {
            throw new UnprocessableEntityException(
                    "The following items expire within " + NEAR_EXPIRY_DAYS + " days: " + String.join(", ", nearExpiry)
                    + ". If you still want to add them (e.g. bought at a discount), set allowNearExpiry and try again.");
        }
    }

    /**
     * Confirms a DRAFT GRN: posts every line into {@link Inventory} (merging into
     * an existing batch or creating one), writes one {@link InventoryMovement} per
     * line, increments the supplier's ledger balance, sets the payment due date
     * from the supplier's credit terms, and rolls the linked PO's status forward.
     * All in one transaction — a partial post would silently desync stock from
     * the GRN that's supposed to explain it.
     */
    @Transactional
    public GrnResponse confirmGrn(String id) {
        // Locking load, not the plain one: see lockByIdAndPharmacyId. Confirming is
        // the point where stock is received and the supplier is debited, and the
        // DRAFT check below is a check-then-act that only holds if nobody else can be
        // between the read and the write.
        GoodsReceiptNote grn = grnRepository.lockByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("GRN not found"));
        if (grn.getStatus() != GRNStatus.DRAFT) {
            throw new ConflictException("Only DRAFT GRNs can be confirmed");
        }
        // Locking load, not loadSupplier(): confirming debits the supplier's running
        // ledger balance further down, and the GRN lock above only serialises THIS
        // GRN — a payment or a supplier return for the same supplier would still
        // interleave and lose one adjustment. Taken after the GRN lock so the order
        // stays document-then-supplier everywhere.
        Supplier supplier = supplierRepository.lockByIdAndPharmacyId(grn.getSupplierId(), TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier not found"));
        List<GRNItem> items = grnItemRepository.findByGrnId(id);
        String userId = TenantContext.userId();

        for (GRNItem item : items) {
            int totalQty = item.totalBaseUnits();
            Inventory inv = inventoryRepository
                    .findByPharmacyIdAndMedicineIdAndBatchNumber(grn.getPharmacyId(), item.getMedicineId(), item.getBatchNumber())
                    .orElse(null);
            int quantityBefore;
            if (inv != null) {
                quantityBefore = inv.getQuantity();
                inv.mergeIncoming(totalQty, item.getPurchaseRate(), item.getMrp(), item.getExpiryDate());
            } else {
                quantityBefore = 0;
                inv = Inventory.create(grn.getPharmacyId(), item.getMedicineId(), item.getBatchNumber(),
                        item.getExpiryDate(), totalQty, item.getPurchaseRate(), item.getMrp(), 10, 5);
                inventoryRepository.save(inv);
            }
            item.setInventoryId(inv.getId());

            String notes = "GRN " + grn.getGrnNumber() + (item.getFreeQty() > 0 ? " (incl. " + item.getFreeQty() + " free)" : "");
            movementRepository.save(InventoryMovement.record(grn.getPharmacyId(), inv.getId(), userId,
                    MovementType.PURCHASE, MovementDirection.IN, totalQty, quantityBefore, quantityBefore + totalQty,
                    "GRN", grn.getId(), notes));
        }

        grn.confirm(supplier.getCreditDays());
        supplier.adjustLedgerBalance(grn.getTotalAmount());

        if (grn.getPurchaseOrderId() != null) {
            rollUpPurchaseOrderStatus(grn.getPurchaseOrderId());
        }

        return toResponse(grn, supplier, items, null);
    }

    /** PARTIAL once any GRN is confirmed against the PO; RECEIVED once every named line's ordered qty is covered. */
    private void rollUpPurchaseOrderStatus(String purchaseOrderId) {
        // Tenant-scoped: this WRITES the PO's status below. The id comes from a GRN
        // that was itself loaded tenant-scoped, so the unscoped findById was not
        // exploitable — but the repository already offers the scoped finder, and
        // relying on provenance is what the other write paths in this codebase were
        // just corrected for.
        PurchaseOrder po = purchaseOrderRepository
                .findByIdAndPharmacyId(purchaseOrderId, TenantContext.pharmacyId()).orElse(null);
        if (po == null || po.getStatus() == PurchaseStatus.CANCELLED) {
            return;
        }
        List<GoodsReceiptNote> confirmedGrns = grnRepository.findByPurchaseOrderIdAndStatus(purchaseOrderId, GRNStatus.CONFIRMED);
        List<String> grnIds = confirmedGrns.stream().map(GoodsReceiptNote::getId).toList();
        List<GRNItem> receivedItems = grnIds.isEmpty() ? List.of() : grnItemRepository.findByGrnIdIn(grnIds);

        Map<String, Integer> receivedByMedicine = new HashMap<>();
        for (GRNItem item : receivedItems) {
            receivedByMedicine.merge(item.getMedicineId(), item.getReceivedQty() + item.getFreeQty(), Integer::sum);
        }

        List<PurchaseOrderItemSnapshot> poItems = po.getItems();
        boolean allCovered = !poItems.isEmpty() && poItems.stream()
                .allMatch(i -> receivedByMedicine.getOrDefault(i.medicineId(), 0) >= i.quantity());

        if (allCovered) {
            po.markFullyReceived();
        } else {
            po.markPartiallyReceived();
        }
    }

    @Transactional
    public GrnResponse cancelGrn(String id) {
        GoodsReceiptNote grn = loadGrn(id);
        if (grn.getStatus() != GRNStatus.DRAFT) {
            throw new ConflictException("Only DRAFT GRNs can be cancelled");
        }
        grn.cancel();
        Supplier supplier = loadSupplier(grn.getSupplierId());
        return toResponse(grn, supplier, grnItemRepository.findByGrnId(id), null);
    }

    @Transactional(readOnly = true)
    public GrnResponse getGrnById(String id) {
        GoodsReceiptNote grn = loadGrn(id);
        Supplier supplier = loadSupplier(grn.getSupplierId());
        return toResponse(grn, supplier, grnItemRepository.findByGrnId(id), null);
    }

    @Transactional(readOnly = true)
    public GrnPageResponse listGrns(String status, String supplierId, Instant from, Instant to, boolean overdue,
                                    int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<GoodsReceiptNote> result = grnRepository.search(TenantContext.pharmacyId(), blankToNull(status),
                blankToNull(supplierId), overdue, Instant.now(), DateRange.from(from), DateRange.to(to),
                PageRequest.of(safePage - 1, safeLimit));

        List<GoodsReceiptNote> grns = result.getContent();

        // Two batched lookups for the whole page instead of two queries per row:
        //  (1) line-item counts (the list shows a count, never the lines);
        //  (2) linked-PO order numbers (only GRNs that reference a PO).
        String pharmacyId = TenantContext.pharmacyId();
        List<String> grnIds = grns.stream().map(GoodsReceiptNote::getId).toList();
        Map<String, Long> itemCounts = new HashMap<>();
        if (!grnIds.isEmpty()) {
            for (var row : grnItemRepository.countByGrnIdIn(pharmacyId, grnIds)) {
                itemCounts.put(row.getGrnId(), row.getCnt());
            }
        }
        List<String> poIds = grns.stream().map(GoodsReceiptNote::getPurchaseOrderId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, GrnResponse.PurchaseOrderRef> poRefs = new HashMap<>();
        if (!poIds.isEmpty()) {
            for (var row : purchaseOrderRepository.findRefsByIdIn(pharmacyId, poIds)) {
                poRefs.put(row.getId(), new GrnResponse.PurchaseOrderRef(row.getId(), row.getOrderNumber()));
            }
        }

        List<GrnResponse> items = grns.stream()
                .map(grn -> toGrnListResponse(grn, itemCounts.getOrDefault(grn.getId(), 0L).intValue(),
                        grn.getPurchaseOrderId() == null ? null : poRefs.get(grn.getPurchaseOrderId())))
                .toList();
        return new GrnPageResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private PurchaseOrder loadPO(String id) {
        return purchaseOrderRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Purchase order not found"));
    }

    private GoodsReceiptNote loadGrn(String id) {
        return grnRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("GRN not found"));
    }

    private Supplier loadSupplier(String id) {
        return supplierRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier not found"));
    }

    private void validateMedicinesExist(List<String> medicineIds) {
        Set<String> requested = new HashSet<>(medicineIds);
        Set<String> found = new HashSet<>();
        medicineRepository.findAllById(requested).forEach(m -> found.add(m.getId()));
        if (!found.containsAll(requested)) {
            throw new NotFoundException("One or more medicines could not be found");
        }
    }

    private List<PurchaseOrderResponse.GrnRef> findGrnRefs(String purchaseOrderId) {
        return grnRepository.findByPurchaseOrderId(purchaseOrderId).stream()
                .map(g -> new PurchaseOrderResponse.GrnRef(g.getId(), g.getGrnNumber(), g.getStatus().name(),
                        g.getCreatedAt(), g.getTotalAmount()))
                .toList();
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private PurchaseOrderResponse toResponse(PurchaseOrder po, List<PurchaseOrderResponse.GrnRef> grns) {
        return toResponse(po, po.getSupplier(), grns);
    }

    /**
     * supplierOverride exists because a just-created PurchaseOrder's lazy
     * `supplier` relation is never populated: Hibernate only initializes an
     * association when the entity is loaded via a query (see loadPO's
     * LEFT JOIN FETCH); an entity built with `new` + persist() and never
     * reloaded keeps whatever the constructor left there (null). createPO
     * already has the Supplier in hand from loadSupplier() — pass it here
     * instead of relying on po.getSupplier().
     */
    private PurchaseOrderResponse toResponse(PurchaseOrder po, Supplier supplierOverride,
                                             List<PurchaseOrderResponse.GrnRef> grns) {
        Supplier s = supplierOverride;
        PurchaseOrderResponse.SupplierRef supplierRef = s == null ? null
                : new PurchaseOrderResponse.SupplierRef(s.getId(), s.getName(), s.getPhone(), s.getEmail());
        List<PurchaseOrderResponse.ItemSnapshot> items = po.getItems().stream()
                .map(i -> new PurchaseOrderResponse.ItemSnapshot(i.medicineId(), i.medicineName(), i.batchNumber(),
                        i.expiryDate(), i.quantity(), i.purchaseRate(), i.mrp(), i.gstRate(), i.cgst(), i.sgst(), i.amount()))
                .toList();
        return new PurchaseOrderResponse(po.getId(), po.getOrderNumber(), supplierRef, po.getInvoiceNo(),
                po.getStatus().name(), po.getApprovalStatus().name(), po.getApprovedBy(), po.getApprovedAt(),
                po.getRejectionReason(), po.getSubtotal(), po.getTotalGst(), po.getTotalAmount(), po.getNotes(),
                po.getExpectedDate(), po.getOrderedAt(), po.getReceivedAt(), items, po.getItemCount(), grns,
                po.getSourceUploadId());
    }

    /**
     * List-row builder — supplier is fetch-joined by the list query, and the line-item
     * snapshots and GRN refs are omitted (the list renders only a header + itemCount).
     * itemCount comes off the denormalized column, so no items JSON is read or shipped.
     */
    private PurchaseOrderResponse toPoListResponse(PurchaseOrder po) {
        Supplier s = po.getSupplier();
        PurchaseOrderResponse.SupplierRef supplierRef = s == null ? null
                : new PurchaseOrderResponse.SupplierRef(s.getId(), s.getName(), s.getPhone(), s.getEmail());
        return new PurchaseOrderResponse(po.getId(), po.getOrderNumber(), supplierRef, po.getInvoiceNo(),
                po.getStatus().name(), po.getApprovalStatus().name(), po.getApprovedBy(), po.getApprovedAt(),
                po.getRejectionReason(), po.getSubtotal(), po.getTotalGst(), po.getTotalAmount(), po.getNotes(),
                po.getExpectedDate(), po.getOrderedAt(), po.getReceivedAt(), List.of(), po.getItemCount(), List.of(),
                po.getSourceUploadId());
    }

    private GrnResponse toResponse(GoodsReceiptNote grn, Supplier supplier, List<GRNItem> items, String warning) {
        GrnResponse.SupplierRef supplierRef = supplier == null ? null
                : new GrnResponse.SupplierRef(supplier.getId(), supplier.getName(), supplier.getPhone(), supplier.getCreditDays());
        GrnResponse.PurchaseOrderRef poRef = null;
        if (grn.getPurchaseOrderId() != null) {
            poRef = purchaseOrderRepository.findById(grn.getPurchaseOrderId())
                    .map(po -> new GrnResponse.PurchaseOrderRef(po.getId(), po.getOrderNumber()))
                    .orElse(null);
        }
        List<GrnResponse.Item> itemResponses = items.stream()
                .map(i -> new GrnResponse.Item(i.getId(), i.getMedicineId(), i.getMedicineName(), i.getBatchNumber(),
                        i.getExpiryDate(), i.getOrderedQty(), i.getReceivedQty(), i.getFreeQty(), i.getPurchaseUnit(),
                        i.getConversionFactor(), i.getPurchaseRate(), i.getMrp(), i.getDiscount(), i.getGstRate(),
                        i.getCgst(), i.getSgst(), i.getAmount()))
                .toList();
        return new GrnResponse(grn.getId(), grn.getGrnNumber(), supplierRef, poRef, grn.getSupplierInvoiceNo(),
                grn.getSupplierInvoiceDate(), grn.getStatus().name(), grn.getNotes(), grn.getSubtotal(),
                grn.getTotalGst(), grn.getTotalAmount(), grn.getConfirmedAt(), grn.getPaymentDueDate(),
                itemResponses, itemResponses.size(), warning, grn.getCreatedAt(), grn.getSourceUploadId());
    }

    /**
     * List-row builder — the counterpart to the full {@link #toResponse} above, but
     * without loading or shipping line items. Both the item count and the linked PO's
     * number are pre-resolved by the caller in one batched query each, so a page of
     * GRNs costs a fixed number of queries instead of 2 per row. {@code supplier} is the
     * fetch-joined association from the list query, so reading it triggers no lazy load.
     */
    private GrnResponse toGrnListResponse(GoodsReceiptNote grn, int itemCount, GrnResponse.PurchaseOrderRef poRef) {
        Supplier supplier = grn.getSupplier();
        GrnResponse.SupplierRef supplierRef = supplier == null ? null
                : new GrnResponse.SupplierRef(supplier.getId(), supplier.getName(), supplier.getPhone(), supplier.getCreditDays());
        return new GrnResponse(grn.getId(), grn.getGrnNumber(), supplierRef, poRef, grn.getSupplierInvoiceNo(),
                grn.getSupplierInvoiceDate(), grn.getStatus().name(), grn.getNotes(), grn.getSubtotal(),
                grn.getTotalGst(), grn.getTotalAmount(), grn.getConfirmedAt(), grn.getPaymentDueDate(),
                List.of(), itemCount, null, grn.getCreatedAt(), grn.getSourceUploadId());
    }
}
