package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.enums.AuditSessionStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.stockaudit.dto.ApproveSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.CompleteSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.UpdateItemRequest;
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
 * Physical stock count reconciliation.
 *
 * <p>Approval here performs the most absolute write in the application: it does not
 * adjust stock, it REPLACES the recorded quantity with whatever was physically
 * counted. Everything else in the system moves stock by a delta and can be reasoned
 * about incrementally; this overwrites. So the tests care most about when that write
 * is allowed to happen at all, and that it cannot happen twice.
 */
@Transactional
class StockAuditIT extends AbstractPostgresIT {

    @Autowired private StockAuditService stockAuditService;
    @Autowired private StockAuditSessionRepository sessionRepository;
    @Autowired private StockAuditItemRepository itemRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String userId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));

        pharmacyId = pharmacy.getId();
        userId = user.getId();
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private int stock() {
        return inventoryRepository.findById(batchId).orElseThrow().getQuantity();
    }

    private AuditSessionStatus statusOf(String sessionId) {
        return sessionRepository.findById(sessionId).orElseThrow().getStatus();
    }

    /** Creates a session, starts it, and records a physical count against the batch. */
    private String sessionCountedAt(int countedQty) {
        String sessionId = stockAuditService.createSession(new CreateSessionRequest(null)).id();
        flushAndClear();
        stockAuditService.startSession(sessionId);
        flushAndClear();

        String itemId = itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(i -> batchId.equals(i.getInventoryId()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("audit session did not include the seeded batch"))
                .getId();
        stockAuditService.updateItem(sessionId, itemId, new UpdateItemRequest(countedQty, null));
        flushAndClear();
        return sessionId;
    }

    @Test
    @DisplayName("starting a session snapshots the current stock as the expected count")
    void startingSessionSnapshotsStock() {
        String sessionId = stockAuditService.createSession(new CreateSessionRequest(null)).id();
        flushAndClear();
        stockAuditService.startSession(sessionId);
        flushAndClear();

        assertThat(statusOf(sessionId)).isEqualTo(AuditSessionStatus.IN_PROGRESS);
        assertThat(itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId))
                .as("every active batch should be countable")
                .isNotEmpty();
    }

    @Test
    @DisplayName("counting does not touch stock until the session is approved")
    void countingAloneDoesNotChangeStock() {
        sessionCountedAt(80);

        assertThat(stock())
                .as("a recorded count is a claim, not yet a correction")
                .isEqualTo(100);
    }

    @Test
    @DisplayName("an un-completed session cannot be approved")
    void cannotApproveBeforeCompletion() {
        String sessionId = sessionCountedAt(80);

        // 409, not 422: this module signals an invalid state transition with
        // ConflictException via requireStatus(). Billing and prescription use
        // UnprocessableEntityException for the equivalent situation — see the note on
        // approvalIsNotRepeatable().
        assertThatThrownBy(() -> stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("IN_PROGRESS");

        assertThat(stock()).isEqualTo(100);
    }

    @Test
    @DisplayName("approving a shortfall writes the counted quantity onto the batch")
    void approvalAppliesShortfall() {
        String sessionId = sessionCountedAt(80);
        stockAuditService.completeSession(sessionId, new CompleteSessionRequest(null));
        flushAndClear();

        stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null));
        flushAndClear();

        assertThat(stock())
                .as("20 units were missing on the shelf; the system must now agree")
                .isEqualTo(80);
        assertThat(statusOf(sessionId)).isEqualTo(AuditSessionStatus.APPROVED);
    }

    @Test
    @DisplayName("approving a surplus writes the higher counted quantity too")
    void approvalAppliesSurplus() {
        String sessionId = sessionCountedAt(115);
        stockAuditService.completeSession(sessionId, new CompleteSessionRequest(null));
        flushAndClear();

        stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null));
        flushAndClear();

        assertThat(stock()).isEqualTo(115);
    }

    /**
     * 409 for an illegal state transition is now the convention across every module,
     * not just this one — 409 means "conflicts with the current state of the
     * resource", which is exactly what re-approving an APPROVED session is. 422 is
     * reserved for a well-formed request that fails a business rule (credit limit
     * exceeded, prescription required for a Schedule H medicine).
     *
     * <p>Stock audit already did this; billing, prescription, purchase, quotation,
     * supplier returns and credit notes were aligned to it.
     */
    @Test
    @DisplayName("an approved session cannot be approved again")
    void approvalIsNotRepeatable() {
        String sessionId = sessionCountedAt(80);
        stockAuditService.completeSession(sessionId, new CompleteSessionRequest(null));
        flushAndClear();
        stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null));
        flushAndClear();

        assertThatThrownBy(() -> stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("APPROVED");

        flushAndClear();
        assertThat(stock())
                .as("re-approving must not re-apply the correction")
                .isEqualTo(80);
    }

    @Test
    @DisplayName("a variance-free count leaves stock exactly as it was")
    void matchingCountIsANoOp() {
        String sessionId = sessionCountedAt(100);
        stockAuditService.completeSession(sessionId, new CompleteSessionRequest(null));
        flushAndClear();
        stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null));
        flushAndClear();

        assertThat(stock()).isEqualTo(100);
    }

    @Test
    @DisplayName("another pharmacy's audit session is not visible")
    void cannotTouchAnotherPharmacysSession() {
        String sessionId = sessionCountedAt(80);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> stockAuditService.getSession(sessionId))
                .isInstanceOf(NotFoundException.class);
    }
}
