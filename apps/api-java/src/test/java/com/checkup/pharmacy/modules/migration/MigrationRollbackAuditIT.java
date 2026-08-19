package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.migration.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
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
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Rolling back a data import.
 *
 * <p>Rollback deletes what an import created, which is only safe while nothing has
 * come to depend on it. These pin the two ways that went wrong: a rollback after the
 * pharmacy had started trading used to reach the database and be refused there — so
 * nothing was undone and the message explained nothing — and deactivating a medicine
 * from the SHARED catalogue used to reach across into other pharmacies' accounts.
 */
@Transactional
class MigrationRollbackAuditIT extends AbstractPostgresIT {

    @Autowired private MigrationService migrationService;
    @Autowired private BillingService billingService;
    @Autowired private MedicineMappingRepository mappingRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private static final Map<String, String> IDENTITY = Map.of(
            "medicineName", "medicineName", "batchNumber", "batchNumber", "expiryDate", "expiryDate",
            "quantity", "quantity", "mrp", "mrp", "purchaseRate", "purchaseRate");

    private String pharmacyId;
    private String userId;
    private String medicineId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));

        pharmacyId = pharmacy.getId();
        userId = user.getId();
        medicineId = medicine.getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    @Nested
    @DisplayName("once the imported data is in use")
    class InUse {

        @Test
        @DisplayName("rollback is refused, and says which data is in the way")
        void refusedWithAReason() {
            String sessionId = importOneBatch();
            Inventory batch = batch();

            billingService.createInvoice(new CreateInvoiceRequest(
                    null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batch.getId(), 5, null, BigDecimal.ZERO, null))));
            flushAndClear();

            assertThatThrownBy(() -> migrationService.rollbackSession(sessionId))
                    .isInstanceOf(ConflictException.class)
                    // Names the actual obstacle, not "this record conflicts with existing data".
                    .hasMessageContaining("can no longer be rolled back")
                    .hasMessageContaining("1 imported batch has been sold on a bill");
        }

        @Test
        @DisplayName("nothing is deleted when the rollback is refused")
        void refusalLeavesEverythingIntact() {
            String sessionId = importOneBatch();
            billingService.createInvoice(new CreateInvoiceRequest(
                    null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batch().getId(), 5, null, BigDecimal.ZERO, null))));
            flushAndClear();

            assertThatThrownBy(() -> migrationService.rollbackSession(sessionId))
                    .isInstanceOf(ConflictException.class);
            flushAndClear();

            // The batch survives, with the sale still applied to it.
            assertThat(inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                    pharmacyId, medicineId, "BATCH-1"))
                    .isPresent()
                    .get().extracting(Inventory::getQuantity).isEqualTo(95);
        }

        @Test
        @DisplayName("a stock adjustment also blocks it — history would be deleted from under it")
        void adjustmentBlocksRollback() {
            String sessionId = importOneBatch();
            String batchId = batch().getId();

            // An adjustment writes a movement that is not the import's opening balance.
            // Inserted directly so the test does not depend on the adjustment endpoint's
            // own rules (role checks, status), which are not what is under test here.
            entityManager.createNativeQuery(
                            "INSERT INTO inventory_movements (id, \"pharmacyId\", \"inventoryId\", \"userId\", type, "
                                    + "direction, quantity, \"quantityBefore\", \"quantityAfter\", \"referenceType\", \"createdAt\") "
                                    + "VALUES (?, ?, ?, ?, 'ADJUSTMENT'::\"MovementType\", 'OUT'::\"MovementDirection\", "
                                    + "1, 100, 99, 'CORRECTION', now())")
                    .setParameter(1, "mv-" + unique())
                    .setParameter(2, pharmacyId)
                    .setParameter(3, batchId)
                    .setParameter(4, userId)
                    .executeUpdate();
            flushAndClear();

            assertThatThrownBy(() -> migrationService.rollbackSession(sessionId))
                    .isInstanceOf(ConflictException.class)
                    .hasMessageContaining("stock movement");
        }
    }

    @Nested
    @DisplayName("when the import is untouched")
    class Untouched {

        @Test
        @DisplayName("rollback removes the imported stock")
        void rollbackWorks() {
            String sessionId = importOneBatch();
            assertThat(inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                    pharmacyId, medicineId, "BATCH-1")).isPresent();

            migrationService.rollbackSession(sessionId);
            flushAndClear();

            assertThat(inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                    pharmacyId, medicineId, "BATCH-1")).isEmpty();
        }

        @Test
        @DisplayName("rolling back twice is refused rather than repeated")
        void secondRollbackRefused() {
            String sessionId = importOneBatch();
            migrationService.rollbackSession(sessionId);
            flushAndClear();

            assertThatThrownBy(() -> migrationService.rollbackSession(sessionId))
                    .isInstanceOf(ConflictException.class)
                    .hasMessageContaining("already been rolled back");
        }
    }

    @Nested
    @DisplayName("the shared medicine catalogue")
    class SharedCatalogue {

        @Test
        @DisplayName("a catalogue entry another pharmacy stocks is NOT deactivated")
        void doesNotReachIntoAnotherPharmacy() {
            // Pharmacy A imports, creating the link to the catalogue entry.
            String sessionId = importOneBatch();

            // Pharmacy B independently stocks the same catalogue medicine. Medicine has
            // no pharmacyId — the catalogue is shared platform-wide — so this is exactly
            // what medicine resolution does for a second pharmacy importing the name.
            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            inventoryRepository.save(Inventory.create(other.getId(), medicineId, "THEIR-BATCH",
                    Instant.now().plus(365, ChronoUnit.DAYS), 50,
                    new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5));
            flushAndClear();

            migrationService.rollbackSession(sessionId);
            flushAndClear();

            // A's batch is gone, but the catalogue entry stays sellable for B. Deactivating
            // it would fail B's bills with "Medicine is inactive and cannot be billed".
            assertThat(inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumber(
                    pharmacyId, medicineId, "BATCH-1")).isEmpty();
            assertThat(medicineRepository.findById(medicineId).orElseThrow().isActive())
                    .as("a shared catalogue entry in use elsewhere must stay active")
                    .isTrue();
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String importOneBatch() {
        String sessionId = migrationService.createSession(new CreateSessionRequest("tally", null)).id();
        MedicineMapping mapping = MedicineMapping.create(pharmacyId, "amoxicillin 250");
        mapping.confirm(medicineId, false, userId);
        mappingRepository.save(mapping);
        flushAndClear();

        String expiry = Instant.now().plus(365, ChronoUnit.DAYS)
                .atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_LOCAL_DATE);
        String csv = "medicineName,batchNumber,expiryDate,quantity,mrp,purchaseRate\n"
                + "Amoxicillin 250,BATCH-1," + expiry + ",100,20,10\n";
        migrationService.commitInventory(sessionId, csv, IDENTITY);
        flushAndClear();
        return sessionId;
    }

    private Inventory batch() {
        return inventoryRepository
                .findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, medicineId, "BATCH-1").orElseThrow();
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
