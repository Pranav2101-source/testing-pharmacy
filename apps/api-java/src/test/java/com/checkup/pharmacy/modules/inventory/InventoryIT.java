package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
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
 * Stock reservation against a real database.
 *
 * <p>Reservations are the coupling between two tills working the same shelf: billing
 * subtracts {@code reservedQuantity} before deciding whether a sale is possible (see
 * BillingService's insufficient-stock check), so a reservation defect does not stay
 * inside this module — it either oversells stock or makes sellable stock unsellable.
 *
 * <p>The multi-session behaviour here is why these are integration tests. "Session A
 * holds 60, so session B may only take 40" is a statement about rows two callers both
 * see, which a mock cannot represent honestly.
 */
@Transactional
class InventoryIT extends AbstractPostgresIT {

    @Autowired private InventoryService inventoryService;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private StockReservationRepository reservationRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String userId;
    private String medicineId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));

        pharmacyId = pharmacy.getId();
        userId = user.getId();
        medicineId = medicine.getId();
        batchId = inventoryRepository.save(newBatch("BATCH-1", 100)).getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    /** See BillingIT#flushAndClear — Inventory.medicine is a read-only join column. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private Inventory newBatch(String batchNumber, int quantity) {
        return Inventory.create(pharmacyId, medicineId, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), quantity,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
    }

    private Inventory batch() {
        return inventoryRepository.findById(batchId).orElseThrow();
    }

    private static ReserveStockRequest reservation(String sessionId, String inventoryId, int quantity) {
        return new ReserveStockRequest(sessionId,
                List.of(new ReserveStockRequest.Item(inventoryId, quantity)));
    }

    @Test
    @DisplayName("reserving holds the quantity against the batch")
    void reserveHoldsStock() {
        inventoryService.reserve(reservation("session-a", batchId, 30));
        flushAndClear();

        assertThat(batch().getReservedQuantity()).isEqualTo(30);
        assertThat(batch().getQuantity())
                .as("a reservation holds stock, it does not consume it")
                .isEqualTo(100);
    }

    @Test
    @DisplayName("a second session cannot reserve stock the first is already holding")
    void otherSessionCannotTakeReservedStock() {
        inventoryService.reserve(reservation("session-a", batchId, 80));
        flushAndClear();

        assertThatThrownBy(() -> inventoryService.reserve(reservation("session-b", batchId, 30)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Insufficient unreserved stock");
    }

    @Test
    @DisplayName("a second session may still take what the first left behind")
    void otherSessionMayTakeTheRemainder() {
        inventoryService.reserve(reservation("session-a", batchId, 80));
        flushAndClear();

        inventoryService.reserve(reservation("session-b", batchId, 20));
        flushAndClear();

        assertThat(batch().getReservedQuantity())
                .as("80 + 20 = the whole batch, and no more")
                .isEqualTo(100);
    }

    @Test
    @DisplayName("re-reserving in the same session replaces its previous hold, it does not stack")
    void sameSessionReplacesItsOwnReservation() {
        inventoryService.reserve(reservation("session-a", batchId, 60));
        flushAndClear();
        inventoryService.reserve(reservation("session-a", batchId, 70));
        flushAndClear();

        // Stacking would give 130 against a 100-unit batch and wedge the batch.
        assertThat(batch().getReservedQuantity()).isEqualTo(70);
        assertThat(reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, "session-a"))
                .as("the old reservation row must be replaced, not accumulated")
                .hasSize(1);
    }

    @Test
    @DisplayName("releasing a session frees everything it held")
    void releaseFreesStock() {
        inventoryService.reserve(reservation("session-a", batchId, 40));
        flushAndClear();

        inventoryService.release("session-a");
        flushAndClear();

        assertThat(batch().getReservedQuantity()).isZero();
        assertThat(reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, "session-a")).isEmpty();
    }

    @Test
    @DisplayName("an expired reservation is released and its stock becomes sellable again")
    void expiredReservationIsReleased() {
        inventoryService.reserve(reservation("session-a", batchId, 50));
        flushAndClear();

        // Backdate the TTL rather than waiting 15 minutes for it.
        entityManager.createQuery(
                        "UPDATE StockReservation r SET r.expiresAt = :past WHERE r.sessionId = :sid")
                .setParameter("past", Instant.now().minus(1, ChronoUnit.HOURS))
                .setParameter("sid", "session-a")
                .executeUpdate();
        flushAndClear();

        int released = inventoryService.releaseExpiredReservationsFor(pharmacyId);
        flushAndClear();

        assertThat(released).isEqualTo(1);
        assertThat(batch().getReservedQuantity())
                .as("abandoned billing sessions must not hold stock forever")
                .isZero();
    }

    @Test
    @DisplayName("another pharmacy's batch cannot be reserved")
    void cannotReserveAnotherPharmacysBatch() {
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        String foreignId = inventoryRepository.save(Inventory.create(other.getId(), medicineId,
                "FOREIGN-1", Instant.now().plus(365, ChronoUnit.DAYS), 50,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
        flushAndClear();

        assertThatThrownBy(() -> inventoryService.reserve(reservation("session-a", foreignId, 1)))
                .isInstanceOf(NotFoundException.class);

        assertThat(inventoryRepository.findById(foreignId).orElseThrow().getReservedQuantity())
                .as("another tenant's stock must not be held")
                .isZero();
    }

    /**
     * The same batch listed twice in one reserve request.
     *
     * <p>Each duplicate line is checked against availability independently, so two
     * lines of 60 both pass against a 100-unit batch and both get applied — leaving
     * reservedQuantity at 120, since {@code Inventory.reserve} clamps only at zero.
     *
     * <p>The unique index on (pharmacyId, inventoryId, sessionId) does stop that
     * reaching the database, so this was never a lasting over-reservation. What it was
     * is an unreadable failure: the pharmacist saw the generic
     * "This record conflicts with existing data" that GlobalExceptionHandler produces
     * for any constraint violation. The service now rejects it up front with a reason.
     */
    @Test
    @DisplayName("the same batch twice in one request is rejected with a clear reason")
    void duplicateLinesAreRejectedClearly() {
        var request = new ReserveStockRequest("session-a", List.of(
                new ReserveStockRequest.Item(batchId, 60),
                new ReserveStockRequest.Item(batchId, 60)));

        assertThatThrownBy(() -> inventoryService.reserve(request))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Duplicate inventory items");

        flushAndClear();
        assertThat(batch().getReservedQuantity())
                .as("a rejected reservation must hold nothing")
                .isZero();
    }
}
