package com.checkup.pharmacy.modules.supplierreturn;

import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.enums.SupplierReturnStatus;
import com.checkup.pharmacy.common.exception.ConflictException;
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
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.supplierreturn.dto.CreateSupplierReturnRequest;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnItemRequest;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnPageResponse;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Debit notes raised when the pharmacy sends goods back to a supplier, scoped to
 * the caller's pharmacy. Confirming decrements inventory (batch-validated so a
 * return spanning several lines against the same batch can't over-draw it) and
 * decrements the supplier's running ledger balance.
 */
@Service
public class SupplierReturnsService {

    private final SupplierReturnRepository returnRepository;
    private final SupplierRepository supplierRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository movementRepository;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.modules.pharmacy.PharmacyRepository pharmacyRepository;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public SupplierReturnsService(SupplierReturnRepository returnRepository, SupplierRepository supplierRepository,
                                  InventoryRepository inventoryRepository, InventoryMovementRepository movementRepository,
                                  DocumentSequenceService sequenceService,
                                  com.checkup.pharmacy.modules.pharmacy.PharmacyRepository pharmacyRepository,
                                  com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.pharmacyRepository = pharmacyRepository;
        this.returnRepository = returnRepository;
        this.supplierRepository = supplierRepository;
        this.inventoryRepository = inventoryRepository;
        this.movementRepository = movementRepository;
        this.sequenceService = sequenceService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    /** Same rule as the purchase side — see TaxJurisdiction for why it fails safe. */
    private boolean isInterstate(com.checkup.pharmacy.modules.supplier.Supplier supplier) {
        String pharmacyState = pharmacyRepository.findById(TenantContext.pharmacyId())
                .map(com.checkup.pharmacy.modules.pharmacy.Pharmacy::getState)
                .orElse(null);
        return com.checkup.pharmacy.common.tax.TaxJurisdiction.isInterstate(pharmacyState, supplier.getState());
    }

    @Transactional
    public SupplierReturnResponse create(CreateSupplierReturnRequest req) {
        duplicateSubmitGuard.guard("supplier.return.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        Supplier supplier = loadSupplier(req.supplierId());

        // A debit note reverses input tax credit, so it has to reverse it under the SAME head
        // the purchase claimed it under. The igst slot on the snapshot has existed all along
        // and was being handed a hard-coded zero, which meant a return against an inter-state
        // purchase reversed CGST and SGST that were never claimed.
        boolean isInterstate = isInterstate(supplier);
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal totalCgst = BigDecimal.ZERO;
        BigDecimal totalSgst = BigDecimal.ZERO;
        BigDecimal totalIgst = BigDecimal.ZERO;
        List<SupplierReturnItemSnapshot> snapshots = new ArrayList<>();
        for (SupplierReturnItemRequest item : req.items()) {
            GstCalculator.PurchaseLineGst gst = GstCalculator.calcPurchaseLineGst(
                    item.purchaseRate(), item.quantity(), BigDecimal.ZERO, item.gstRateOrDefault(), isInterstate);
            subtotal = subtotal.add(gst.lineTotal());
            totalCgst = totalCgst.add(gst.cgst());
            totalSgst = totalSgst.add(gst.sgst());
            totalIgst = totalIgst.add(gst.igst());
            snapshots.add(new SupplierReturnItemSnapshot(item.inventoryId(), item.medicineId(), item.medicineName(),
                    item.batchNumber(), item.expiryDate().toString(), item.quantity(), item.purchaseRate(),
                    gst.lineTotal(), item.gstRateOrDefault(), gst.cgst(), gst.sgst(), gst.igst(), gst.amount(),
                    item.reasonOrDefault()));
        }
        BigDecimal totalGst = totalCgst.add(totalSgst).add(totalIgst);

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.SUPPLIER_RETURN);
        SupplierReturn sr = SupplierReturn.create(pharmacyId, supplier.getId(),
                DocumentNumberFormat.supplierReturn(seq), blankToNull(req.debitNoteNo()), req.notes(), snapshots,
                subtotal, totalCgst, totalSgst, totalIgst, totalGst);
        returnRepository.save(sr);

        return toResponse(sr, supplier);
    }

    /**
     * Batch-reads every distinct inventory row referenced once, aggregates
     * requested quantity per row (a return can list the same batch across
     * multiple lines), validates the whole set, then decrements and writes one
     * movement per line — matching the Node original's semantics without N
     * sequential round-trips.
     */
    @Transactional
    public SupplierReturnResponse confirm(String id) {
        // Locking load: the DRAFT check below guards a stock deduction and a supplier
        // credit, and only holds if no one else can be between the read and the write.
        // Same reasoning as PurchasesService.confirmGrn.
        SupplierReturn sr = returnRepository.lockByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier return not found"));
        if (sr.getStatus() != SupplierReturnStatus.DRAFT) {
            throw new ConflictException("Only DRAFT supplier returns can be confirmed");
        }

        List<String> inventoryIds = sr.getItems().stream().map(SupplierReturnItemSnapshot::inventoryId).distinct().toList();
        Map<String, Inventory> byId = new HashMap<>();
        for (Inventory inv : inventoryRepository.findAllById(inventoryIds)) {
            if (inv.getPharmacyId().equals(sr.getPharmacyId())) {
                byId.put(inv.getId(), inv);
            }
        }

        Map<String, Integer> totalRequested = new HashMap<>();
        for (SupplierReturnItemSnapshot item : sr.getItems()) {
            totalRequested.merge(item.inventoryId(), item.quantity(), Integer::sum);
        }
        for (Map.Entry<String, Integer> e : totalRequested.entrySet()) {
            Inventory inv = byId.get(e.getKey());
            if (inv == null) {
                throw new NotFoundException("A stock entry referenced by this return no longer exists (id " + e.getKey() + ")");
            }
            if (inv.getQuantity() < e.getValue()) {
                throw new UnprocessableEntityException(
                        "Cannot return " + e.getValue() + " units from batch " + inv.getBatchNumber()
                        + ": only " + inv.getQuantity() + " in stock");
            }
        }

        String userId = TenantContext.userId();
        for (SupplierReturnItemSnapshot item : sr.getItems()) {
            Inventory inv = byId.get(item.inventoryId());
            int quantityBefore = inv.getQuantity();
            inv.setQuantity(quantityBefore - item.quantity());
            movementRepository.save(InventoryMovement.record(sr.getPharmacyId(), inv.getId(), userId,
                    MovementType.ADJUSTMENT, MovementDirection.OUT, item.quantity(), quantityBefore,
                    quantityBefore - item.quantity(), "SUPPLIER_RETURN", sr.getId(),
                    "Supplier return " + sr.getReturnNumber() + " — " + item.reason()));
        }

        sr.confirm();
        // Locking load, not loadSupplier(): this adjusts the running ledger balance,
        // which a concurrent GRN confirm or payment for the same supplier would
        // otherwise interleave with. Taken after the supplier-return row lock above,
        // keeping lock order document-then-supplier across all three flows.
        supplierRepository.lockByIdAndPharmacyId(sr.getSupplierId(), TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier not found"))
                .adjustLedgerBalance(sr.getTotalAmount().negate());

        return toResponse(sr);
    }

    @Transactional
    public SupplierReturnResponse cancel(String id) {
        SupplierReturn sr = loadReturn(id);
        if (sr.getStatus() != SupplierReturnStatus.DRAFT) {
            throw new UnprocessableEntityException("Only DRAFT supplier returns can be cancelled");
        }
        sr.cancel();
        return toResponse(sr);
    }

    @Transactional(readOnly = true)
    public SupplierReturnResponse getById(String id) {
        return toResponse(loadReturn(id));
    }

    @Transactional(readOnly = true)
    public SupplierReturnPageResponse list(String status, String supplierId, Instant from, Instant to, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<SupplierReturn> result = returnRepository.search(TenantContext.pharmacyId(), blankToNull(status),
                blankToNull(supplierId), DateRange.from(from), DateRange.to(to), PageRequest.of(safePage - 1, safeLimit));

        List<SupplierReturnResponse> items = result.getContent().stream().map(this::toResponse).toList();
        return new SupplierReturnPageResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    private SupplierReturn loadReturn(String id) {
        return returnRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier return not found"));
    }

    private Supplier loadSupplier(String id) {
        return supplierRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Supplier not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private SupplierReturnResponse toResponse(SupplierReturn sr) {
        return toResponse(sr, sr.getSupplier());
    }

    /**
     * supplierOverride exists because a just-created SupplierReturn's lazy
     * `supplier` relation is never populated — see PurchasesService's identical
     * note on toResponse(PurchaseOrder, Supplier, ...) for why. create() already
     * has the Supplier from loadSupplier(); pass it here instead of relying on
     * sr.getSupplier().
     */
    private SupplierReturnResponse toResponse(SupplierReturn sr, Supplier supplierOverride) {
        Supplier s = supplierOverride;
        SupplierReturnResponse.SupplierRef supplierRef = s == null ? null
                : new SupplierReturnResponse.SupplierRef(s.getId(), s.getName(), s.getPhone(), s.getGstin());
        List<SupplierReturnResponse.ItemSnapshot> items = sr.getItems().stream()
                .map(i -> new SupplierReturnResponse.ItemSnapshot(i.inventoryId(), i.medicineId(), i.medicineName(),
                        i.batchNumber(), i.expiryDate(), i.quantity(), i.purchaseRate(), i.taxableAmount(),
                        i.gstRate(), i.cgst(), i.sgst(), i.igst(), i.amount(), i.reason()))
                .toList();
        return new SupplierReturnResponse(sr.getId(), sr.getReturnNumber(), supplierRef, sr.getDebitNoteNo(),
                sr.getStatus().name(), sr.getNotes(), sr.getSubtotal(), sr.getTaxableAmount(), sr.getCgst(),
                sr.getSgst(), sr.getIgst(), sr.getTotalGst(), sr.getTotalAmount(), items, sr.getItemCount(),
                sr.getCreatedAt());
    }
}
