package com.checkup.pharmacy.modules.supplierreturn;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.PurchasesService;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.supplierreturn.dto.CreateSupplierReturnRequest;
import com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnItemRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Supplier returns (debit notes) — goods physically sent back to a distributor.
 *
 * <p>This module had no coverage of its own. It matters because confirming a
 * return does two irreversible things at once: it takes stock OFF the shelf and
 * it reduces what the pharmacy owes the supplier. A return that decrements stock
 * but not the ledger means paying for goods already sent back; one that
 * decrements stock twice means the shelf count no longer matches reality, which
 * a pharmacy only discovers at the next physical audit.
 *
 * <p>The DRAFT → CONFIRMED transition is therefore the centre of this suite.
 */
@Transactional
class SupplierReturnIT extends AbstractPostgresIT {

    @Autowired private SupplierReturnsService returnsService;
    @Autowired private PurchasesService purchasesService;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private InventoryMovementRepository movementRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String supplierId;
    private String medicineId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Acme Distributors")).getId();
        medicineId = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12"))).getId();

        flushAndClear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    /** Receives stock through a real confirmed GRN so the batch exists exactly as production would create it. */
    private String receiveStock(String batchNumber, int qty) {
        var item = new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), 0, qty, 0, null, null,
                new BigDecimal("100.00"), new BigDecimal("200.00"), BigDecimal.ZERO, BigDecimal.ZERO);
        String grnId = purchasesService.createGrn(new CreateGrnRequest(
                supplierId, null, "INV-" + unique(), Instant.now(), null, List.of(item), false, null)).id();
        flushAndClear();
        purchasesService.confirmGrn(grnId);
        flushAndClear();
        return inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, medicineId, batchNumber)
                .orElseThrow().getId();
    }

    private SupplierReturnItemRequest line(String inventoryId, String batchNumber, int qty) {
        return new SupplierReturnItemRequest(inventoryId, medicineId, "Amoxicillin 250", batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), qty, new BigDecimal("100.00"),
                new BigDecimal("12"), "DAMAGED");
    }

    private CreateSupplierReturnRequest request(SupplierReturnItemRequest... items) {
        return new CreateSupplierReturnRequest(supplierId, "DN-" + unique(), "damaged in transit", List.of(items));
    }

    private int stockOf(String inventoryId) {
        return inventoryRepository.findById(inventoryId).orElseThrow().getQuantity();
    }

    private BigDecimal ledgerBalance() {
        return supplierRepository.findById(supplierId).orElseThrow().getLedgerBalance();
    }

    @Nested
    @DisplayName("creating a draft")
    class Create {

        @Test
        @DisplayName("a new return starts as DRAFT and takes no stock yet")
        void createdReturnIsDraftAndDoesNotMoveStock() {
            // Creating is a paperwork step. Nothing leaves the shelf until confirm.
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();

            assertThat(created.status()).isEqualTo("DRAFT");
            assertThat(stockOf(inv)).isEqualTo(100);
        }

        @Test
        @DisplayName("allocates a sequential return number")
        void allocatesReturnNumber() {
            String inv = receiveStock("B-1", 100);
            var first = returnsService.create(request(line(inv, "B-1", 1)));
            flushAndClear();
            var second = returnsService.create(request(line(inv, "B-1", 1)));
            flushAndClear();

            assertThat(first.returnNumber()).isNotBlank();
            assertThat(second.returnNumber()).isNotBlank();
            assertThat(first.returnNumber()).isNotEqualTo(second.returnNumber());
        }

        @Test
        @DisplayName("computes purchase-side GST on top of the cost — not reverse-derived from it")
        void computesPurchaseSideGst() {
            // Supplier cost prices in Indian B2B trade are GST-EXCLUSIVE, the opposite
            // of retail MRP. 10 x 100 at 12% must be 1000 + 120, not 1000 inclusive.
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));

            assertThat(created.subtotal()).isEqualByComparingTo(new BigDecimal("1000.00"));
            assertThat(created.totalGst()).isEqualByComparingTo(new BigDecimal("120.00"));
            assertThat(created.totalAmount()).isEqualByComparingTo(new BigDecimal("1120.00"));
        }

        @Test
        @DisplayName("splits GST evenly into CGST and SGST")
        void splitsGstEvenly() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));

            assertThat(created.cgst()).isEqualByComparingTo(created.sgst());
            assertThat(created.cgst().add(created.sgst())).isEqualByComparingTo(created.totalGst());
        }

        @Test
        @DisplayName("an unknown supplier is rejected")
        void unknownSupplierRejected() {
            String inv = receiveStock("B-1", 100);
            assertThatThrownBy(() -> returnsService.create(new CreateSupplierReturnRequest(
                    "does-not-exist", null, null, List.of(line(inv, "B-1", 1)))))
                    .isInstanceOf(NotFoundException.class);
        }
    }

    @Nested
    @DisplayName("confirming — where stock and money actually move")
    class Confirm {

        @Test
        @DisplayName("decrements the batch by exactly the returned quantity")
        void decrementsStock() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 30)));
            flushAndClear();

            returnsService.confirm(created.id());
            flushAndClear();

            assertThat(stockOf(inv)).isEqualTo(70);
        }

        @Test
        @DisplayName("reduces what the pharmacy owes the supplier by the return's total")
        void reducesLedgerBalance() {
            // The whole commercial point: goods went back, so the bill goes down.
            String inv = receiveStock("B-1", 100);
            BigDecimal owedBefore = ledgerBalance();
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();

            returnsService.confirm(created.id());
            flushAndClear();

            assertThat(ledgerBalance()).isEqualByComparingTo(owedBefore.subtract(new BigDecimal("1120.00")));
        }

        @Test
        @DisplayName("writes an OUT stock movement that references the return")
        void writesAuditableMovement() {
            // Without this the stock ledger shows an unexplained drop, and a pharmacist
            // reconciling a physical count has no way to account for it.
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 5)));
            flushAndClear();
            returnsService.confirm(created.id());
            flushAndClear();

            var movements = movementRepository.findAll().stream()
                    .filter(m -> m.getInventoryId().equals(inv))
                    .filter(m -> "SUPPLIER_RETURN".equals(m.getReferenceType()))
                    .toList();

            assertThat(movements).hasSize(1);
            assertThat(movements.get(0).getQuantity()).isEqualTo(5);
            assertThat(movements.get(0).getQuantityBefore()).isEqualTo(100);
            assertThat(movements.get(0).getQuantityAfter()).isEqualTo(95);
            assertThat(movements.get(0).getReferenceId()).isEqualTo(created.id());
        }

        @Test
        @DisplayName("confirming twice is refused — stock must not be taken off the shelf twice")
        void cannotConfirmTwice() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();
            returnsService.confirm(created.id());
            flushAndClear();

            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(ConflictException.class);
            flushAndClear();
            assertThat(stockOf(inv)).isEqualTo(90);
        }

        @Test
        @DisplayName("refuses to return more than is in stock, naming the batch and the real count")
        void cannotReturnMoreThanStocked() {
            String inv = receiveStock("B-1", 5);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();

            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("B-1")
                    .hasMessageContaining("only 5 in stock");
        }

        @Test
        @DisplayName("a rejected over-draw leaves stock and ledger untouched")
        void failedConfirmIsAtomic() {
            String inv = receiveStock("B-1", 5);
            BigDecimal owedBefore = ledgerBalance();
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();

            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(UnprocessableEntityException.class);
            flushAndClear();

            assertThat(stockOf(inv)).isEqualTo(5);
            assertThat(ledgerBalance()).isEqualByComparingTo(owedBefore);
        }

        @Test
        @DisplayName("returning the whole batch takes it to zero, never negative")
        void canReturnEntireBatch() {
            String inv = receiveStock("B-1", 20);
            var created = returnsService.create(request(line(inv, "B-1", 20)));
            flushAndClear();
            returnsService.confirm(created.id());
            flushAndClear();

            assertThat(stockOf(inv)).isZero();
        }

        /**
         * The aggregation rule the service javadoc calls out. Two lines of 60 against a
         * batch of 100 are individually fine and collectively impossible; validating
         * per-line would let stock go to −20.
         */
        @Test
        @DisplayName("two lines against the SAME batch are summed before the stock check")
        void aggregatesRepeatedBatchLinesBeforeValidating() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(
                    line(inv, "B-1", 60),
                    line(inv, "B-1", 60)));
            flushAndClear();

            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("120");
            flushAndClear();
            assertThat(stockOf(inv)).isEqualTo(100);
        }

        @Test
        @DisplayName("two lines against the same batch that DO fit are both applied")
        void appliesBothLinesWhenTheyFit() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(
                    line(inv, "B-1", 30),
                    line(inv, "B-1", 20)));
            flushAndClear();
            returnsService.confirm(created.id());
            flushAndClear();

            assertThat(stockOf(inv)).isEqualTo(50);
        }

        @Test
        @DisplayName("a return spanning two different batches decrements each independently")
        void handlesMultipleBatches() {
            String invA = receiveStock("B-A", 40);
            String invB = receiveStock("B-B", 60);
            var created = returnsService.create(request(
                    line(invA, "B-A", 10),
                    line(invB, "B-B", 25)));
            flushAndClear();
            returnsService.confirm(created.id());
            flushAndClear();

            assertThat(stockOf(invA)).isEqualTo(30);
            assertThat(stockOf(invB)).isEqualTo(35);
        }

        @Test
        @DisplayName("a return referencing stock that no longer exists is reported clearly")
        void missingInventoryIsReported() {
            // `create` snapshots the line without resolving the inventory row, so a
            // draft can outlive the batch it points at (or be built from stale client
            // state). Confirm must say so plainly instead of dereferencing null.
            //
            // Simulated with an unresolvable id rather than by deleting a real batch:
            // a received batch always has an inventory_movements row referencing it,
            // so deleting it fails on that foreign key — itself a useful guarantee
            // (stock history cannot be silently erased).
            var created = returnsService.create(request(line("inventory-that-vanished", "B-GONE", 5)));
            flushAndClear();

            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(NotFoundException.class)
                    .hasMessageContaining("no longer exists");
        }

        @Test
        @DisplayName("a received batch cannot be deleted while its stock history references it")
        void stockHistoryPinsTheBatch() {
            // The other half of the case above, asserted directly: inventory_movements
            // holds an FK to inventory, so an audited batch cannot be made to disappear.
            String inv = receiveStock("B-1", 10);
            Inventory row = inventoryRepository.findById(inv).orElseThrow();
            inventoryRepository.delete(row);

            assertThatThrownBy(() -> entityManager.flush())
                    .hasMessageContaining("inventory_movements");
        }
    }

    @Nested
    @DisplayName("cancelling")
    class Cancel {

        @Test
        @DisplayName("a DRAFT return can be cancelled and moves no stock")
        void cancelDraft() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();

            var cancelled = returnsService.cancel(created.id());
            flushAndClear();

            assertThat(cancelled.status()).isEqualTo("CANCELLED");
            assertThat(stockOf(inv)).isEqualTo(100);
        }

        @Test
        @DisplayName("a CONFIRMED return cannot be cancelled — the goods have already gone")
        void cannotCancelConfirmed() {
            // Reversing a confirmed return would need to put stock back and re-inflate
            // the payable; that is a separate document, not a cancel.
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();
            returnsService.confirm(created.id());
            flushAndClear();

            assertThatThrownBy(() -> returnsService.cancel(created.id()))
                    .isInstanceOf(UnprocessableEntityException.class);
        }

        @Test
        @DisplayName("a CANCELLED return cannot then be confirmed")
        void cannotConfirmCancelled() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();
            returnsService.cancel(created.id());
            flushAndClear();

            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(ConflictException.class);
            flushAndClear();
            assertThat(stockOf(inv)).isEqualTo(100);
        }
    }

    @Nested
    @DisplayName("reads, listing and tenant isolation")
    class Reads {

        @Test
        @DisplayName("an unknown id is reported as not found rather than 500")
        void unknownIdIsNotFound() {
            assertThatThrownBy(() -> returnsService.getById("does-not-exist"))
                    .isInstanceOf(NotFoundException.class);
            assertThatThrownBy(() -> returnsService.confirm("does-not-exist"))
                    .isInstanceOf(NotFoundException.class);
            assertThatThrownBy(() -> returnsService.cancel("does-not-exist"))
                    .isInstanceOf(NotFoundException.class);
        }

        @Test
        @DisplayName("listing returns this pharmacy's returns")
        void listsOwnReturns() {
            String inv = receiveStock("B-1", 100);
            returnsService.create(request(line(inv, "B-1", 1)));
            flushAndClear();

            var page = returnsService.list(null, null, null, null, 1, 20);
            assertThat(page.items()).hasSize(1);
            assertThat(page.total()).isEqualTo(1);
        }

        @Test
        @DisplayName("filters by status")
        void filtersByStatus() {
            String inv = receiveStock("B-1", 100);
            var toCancel = returnsService.create(request(line(inv, "B-1", 1)));
            returnsService.create(request(line(inv, "B-1", 2)));
            flushAndClear();
            returnsService.cancel(toCancel.id());
            flushAndClear();

            assertThat(returnsService.list("DRAFT", null, null, null, 1, 20).items()).hasSize(1);
            assertThat(returnsService.list("CANCELLED", null, null, null, 1, 20).items()).hasSize(1);
        }

        @Test
        @DisplayName("an out-of-range page number is clamped rather than throwing")
        void clampsPaging() {
            // The frontend can request page 0 on a first render; that must not 500.
            var page = returnsService.list(null, null, null, null, 0, 0);
            assertThat(page.page()).isEqualTo(1);
            assertThat(page.limit()).isEqualTo(1);
        }

        @Test
        @DisplayName("another pharmacy's return is invisible and unconfirmable")
        void tenantIsolation() {
            String inv = receiveStock("B-1", 100);
            var created = returnsService.create(request(line(inv, "B-1", 10)));
            flushAndClear();

            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
            flushAndClear();
            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

            assertThatThrownBy(() -> returnsService.getById(created.id()))
                    .isInstanceOf(NotFoundException.class);
            assertThatThrownBy(() -> returnsService.confirm(created.id()))
                    .isInstanceOf(NotFoundException.class);
            assertThat(returnsService.list(null, null, null, null, 1, 20).items()).isEmpty();
        }
    }
}
