package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.GRNStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
 * Goods receipt — the inbound counterpart to billing.
 *
 * <p>Confirming a GRN is the only path by which stock enters inventory, and it debits
 * the supplier ledger in the same transaction. Both effects are cumulative, so the
 * interesting failures here are about a receipt being applied twice or not at all
 * rather than about arithmetic.
 */
@Transactional
class PurchaseIT extends AbstractPostgresIT {

    @Autowired private PurchasesService purchasesService;
    @Autowired private GoodsReceiptNoteRepository grnRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private SupplierRepository supplierRepository;
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

    private GrnItemRequest line(String batchNumber, int receivedQty, int freeQty) {
        return new GrnItemRequest(medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), 0, receivedQty, freeQty,
                null, null, new BigDecimal("10.00"), new BigDecimal("20.00"),
                BigDecimal.ZERO, new BigDecimal("12"));
    }

    private String createDraftGrn(GrnItemRequest... items) {
        var request = new CreateGrnRequest(supplierId, null, "INV-" + unique(), Instant.now(),
                null, List.of(items), false, null);
        String id = purchasesService.createGrn(request).id();
        flushAndClear();
        return id;
    }

    private int stockFor(String batchNumber) {
        return inventoryRepository
                .findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, medicineId, batchNumber)
                .map(Inventory::getQuantity)
                .orElse(0);
    }

    @Test
    @DisplayName("a draft GRN holds no stock until it is confirmed")
    void draftGrnDoesNotAffectStock() {
        createDraftGrn(line("BATCH-A", 50, 0));

        assertThat(stockFor("BATCH-A"))
                .as("goods are not in stock until receipt is confirmed")
                .isZero();
    }

    @Test
    @DisplayName("confirming a GRN brings the stock in and debits the supplier")
    void confirmBringsStockInAndDebitsSupplier() {
        String grnId = createDraftGrn(line("BATCH-A", 50, 0));

        purchasesService.confirmGrn(grnId);
        flushAndClear();

        assertThat(stockFor("BATCH-A")).isEqualTo(50);
        assertThat(grnRepository.findById(grnId).orElseThrow().getStatus()).isEqualTo(GRNStatus.CONFIRMED);
        assertThat(supplierRepository.findById(supplierId).orElseThrow().getLedgerBalance())
                .as("a confirmed receipt is money owed to the supplier")
                .isGreaterThan(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("free quantity is received into stock alongside the billed quantity")
    void freeQuantityIsReceived() {
        String grnId = createDraftGrn(line("BATCH-A", 100, 10));

        purchasesService.confirmGrn(grnId);
        flushAndClear();

        assertThat(stockFor("BATCH-A"))
                .as("110 units physically arrived even though 100 were invoiced")
                .isEqualTo(110);
    }

    /**
     * Guards the lock added to confirmGrn.
     *
     * <p>Sequentially this only exercises the DRAFT status guard. The guard alone was
     * never sufficient: without a row lock it is a check-then-act, so two staff
     * confirming the same delivery at once both read DRAFT, both receive the stock,
     * and both debit the supplier. This pins the observable contract — a GRN confirms
     * exactly once — while lockByIdAndPharmacyId closes the concurrent case.
     */
    @Test
    @DisplayName("a GRN cannot be confirmed twice")
    void grnConfirmsExactlyOnce() {
        String grnId = createDraftGrn(line("BATCH-A", 50, 0));

        purchasesService.confirmGrn(grnId);
        flushAndClear();

        // 409: re-confirming conflicts with the GRN's current state. See the note on
        // StockAuditIT#approvalIsNotRepeatable for the convention.
        assertThatThrownBy(() -> purchasesService.confirmGrn(grnId))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Only DRAFT GRNs can be confirmed");

        flushAndClear();
        assertThat(stockFor("BATCH-A"))
                .as("a rejected second confirmation must not receive the delivery again")
                .isEqualTo(50);
    }

    @Test
    @DisplayName("receiving the same batch again merges into the existing stock line")
    void repeatReceiptMergesIntoSameBatch() {
        purchasesService.confirmGrn(createDraftGrn(line("BATCH-A", 50, 0)));
        flushAndClear();
        purchasesService.confirmGrn(createDraftGrn(line("BATCH-A", 30, 0)));
        flushAndClear();

        assertThat(stockFor("BATCH-A"))
                .as("same medicine and batch number is one stock line, not two")
                .isEqualTo(80);
    }

    @Test
    @DisplayName("distinct batch numbers are kept as separate stock lines")
    void separateBatchesStaySeparate() {
        purchasesService.confirmGrn(createDraftGrn(line("BATCH-A", 50, 0), line("BATCH-B", 20, 0)));
        flushAndClear();

        assertThat(stockFor("BATCH-A")).isEqualTo(50);
        assertThat(stockFor("BATCH-B"))
                .as("batches expire independently and must not be merged")
                .isEqualTo(20);
    }

    @Test
    @DisplayName("another pharmacy's GRN is not visible")
    void cannotConfirmAnotherPharmacysGrn() {
        String grnId = createDraftGrn(line("BATCH-A", 50, 0));

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> purchasesService.confirmGrn(grnId))
                .isInstanceOf(NotFoundException.class);
    }
}
