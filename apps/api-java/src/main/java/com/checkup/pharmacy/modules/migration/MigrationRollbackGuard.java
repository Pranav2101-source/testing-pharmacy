package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.modules.billing.InvoiceItemRepository;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.billing.SalesReturnItemRepository;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNoteRepository;
import com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Decides whether an import can still be rolled back.
 *
 * <p>Rollback DELETES the rows an import created. That is only safe while nothing
 * else has come to depend on them. Once a pharmacy has opened for business, the
 * imported data is load-bearing: a batch has been billed, a customer owes money, a
 * distributor has goods receipts against them.
 *
 * <p>Without this check the delete reached the database and was refused there, which
 * had two consequences. The whole rollback is one transaction, so nothing at all was
 * undone — not even the parts that were still safe to undo. And the pharmacist was
 * shown the generic constraint-violation message, "This record conflicts with
 * existing data — it may already exist", which describes neither the cause nor the
 * remedy.
 *
 * <p>This is a separate component rather than more methods on MigrationService
 * because it needs to reach into billing, purchasing and prescriptions to ask its
 * question, and that coupling is better isolated behind one narrow interface.
 */
@Component
public class MigrationRollbackGuard {

    private final InvoiceRepository invoiceRepository;
    private final InvoiceItemRepository invoiceItemRepository;
    private final SalesReturnItemRepository salesReturnItemRepository;
    private final InventoryMovementRepository movementRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final GoodsReceiptNoteRepository grnRepository;
    private final PurchaseOrderRepository purchaseOrderRepository;

    public MigrationRollbackGuard(InvoiceRepository invoiceRepository,
                                  InvoiceItemRepository invoiceItemRepository,
                                  SalesReturnItemRepository salesReturnItemRepository,
                                  InventoryMovementRepository movementRepository,
                                  PrescriptionRepository prescriptionRepository,
                                  GoodsReceiptNoteRepository grnRepository,
                                  PurchaseOrderRepository purchaseOrderRepository) {
        this.invoiceRepository = invoiceRepository;
        this.invoiceItemRepository = invoiceItemRepository;
        this.salesReturnItemRepository = salesReturnItemRepository;
        this.movementRepository = movementRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.grnRepository = grnRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
    }

    /** One reason a rollback cannot proceed, phrased for the person reading it. */
    public record Blocker(String reason) {
    }

    /**
     * Everything standing in the way of rolling this session back.
     *
     * <p>Returns all of them rather than the first: someone about to undo an import
     * needs the whole picture, not to fix one thing and be told about the next.
     */
    public List<Blocker> findBlockers(String pharmacyId, Map<MigrationEntityType, List<String>> idsByEntityType) {
        List<Blocker> blockers = new ArrayList<>();

        List<String> inventoryIds = idsByEntityType.getOrDefault(MigrationEntityType.INVENTORY, List.of());
        if (!inventoryIds.isEmpty()) {
            long billed = invoiceItemRepository.countByInventoryIdIn(inventoryIds);
            if (billed > 0) {
                blockers.add(new Blocker(plural(billed, "imported batch has", "imported batches have")
                        + " been sold on a bill"));
            }
            long returned = salesReturnItemRepository.countByInventoryIdIn(inventoryIds);
            if (returned > 0) {
                blockers.add(new Blocker(plural(returned, "imported batch appears", "imported batches appear")
                        + " on a sales return"));
            }
            // Anything that is not the import's own opening-balance entry: a stock
            // adjustment, a damage write-off, an approved stock audit. These do not all
            // have a foreign key onto inventory, so they would not have been caught by
            // the database — the stock history would simply have been deleted from
            // under them.
            long otherMovements = movementRepository.countByInventoryIdInAndReferenceTypeNot(
                    inventoryIds, MigrationService.OPENING_BALANCE_REFERENCE);
            if (otherMovements > 0) {
                blockers.add(new Blocker(plural(otherMovements, "stock movement has", "stock movements have")
                        + " been recorded against imported batches since the import"));
            }
        }

        List<String> customerIds = idsByEntityType.getOrDefault(MigrationEntityType.CUSTOMERS, List.of());
        if (!customerIds.isEmpty()) {
            long billed = invoiceRepository.countByPharmacyIdAndCustomerIdIn(pharmacyId, customerIds);
            if (billed > 0) {
                blockers.add(new Blocker(plural(billed, "bill has", "bills have") + " been raised for imported customers"));
            }
        }

        List<String> supplierIds = idsByEntityType.getOrDefault(MigrationEntityType.SUPPLIERS, List.of());
        if (!supplierIds.isEmpty()) {
            long grns = grnRepository.countByPharmacyIdAndSupplierIdIn(pharmacyId, supplierIds);
            if (grns > 0) {
                blockers.add(new Blocker(plural(grns, "goods receipt is", "goods receipts are")
                        + " recorded against imported distributors"));
            }
            long orders = purchaseOrderRepository.countByPharmacyIdAndSupplierIdIn(pharmacyId, supplierIds);
            if (orders > 0) {
                blockers.add(new Blocker(plural(orders, "purchase order is", "purchase orders are")
                        + " recorded against imported distributors"));
            }
        }

        List<String> doctorIds = idsByEntityType.getOrDefault(MigrationEntityType.DOCTORS, List.of());
        if (!doctorIds.isEmpty()) {
            long prescriptions = prescriptionRepository.countByPharmacyIdAndDoctorIdIn(pharmacyId, doctorIds);
            if (prescriptions > 0) {
                blockers.add(new Blocker(plural(prescriptions, "prescription names", "prescriptions name")
                        + " an imported doctor"));
            }
            long bills = invoiceRepository.countByPharmacyIdAndDoctorIdIn(pharmacyId, doctorIds);
            if (bills > 0) {
                blockers.add(new Blocker(plural(bills, "bill names", "bills name") + " an imported doctor"));
            }
        }

        return blockers;
    }

    /** "1 bill has" / "4 bills have" — the count reads as part of the sentence. */
    private static String plural(long count, String singular, String pluralForm) {
        return count + " " + (count == 1 ? singular : pluralForm);
    }

    static boolean isEmpty(Collection<?> c) {
        return c == null || c.isEmpty();
    }
}
