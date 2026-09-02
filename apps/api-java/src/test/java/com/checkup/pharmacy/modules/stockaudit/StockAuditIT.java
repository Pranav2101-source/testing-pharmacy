package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.enums.AuditSessionStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.stockaudit.dto.VarianceSummaryResponse;
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
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
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
        return sessionCountedAt(countedQty, null);
    }

    /** As above, also recording a physically-counted loose remainder. */
    private String sessionCountedAt(int countedQty, Integer countedLooseUnits) {
        String sessionId = stockAuditService.createSession(new CreateSessionRequest(null)).id();
        flushAndClear();
        stockAuditService.startSession(sessionId);
        flushAndClear();

        String itemId = itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(i -> batchId.equals(i.getInventoryId()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("audit session did not include the seeded batch"))
                .getId();
        stockAuditService.updateItem(sessionId, itemId, new UpdateItemRequest(countedQty, countedLooseUnits, null));
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

    // ── Loose (cut-strip) remainder ─────────────────────────────────────────

    private String looseBatchId;
    private String looseMedicineId;

    /** A second, loose-capable batch (10 tablets/strip) — the shared seed medicine is pack-only. */
    private void seedLooseBatch() {
        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("12"));
        medicine.setPackaging(10, "TABLET");
        looseMedicineId = medicineRepository.save(medicine).getId();
        // 10 packs on the shelf, 4 tablets already loose from an opened strip.
        Inventory inv = Inventory.create(pharmacyId, medicine.getId(), "LOOSE-BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 10,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
        inv.restockLoose(4);
        looseBatchId = inventoryRepository.save(inv).getId();
        flushAndClear();
    }

    private int looseStock() {
        return inventoryRepository.findById(looseBatchId).orElseThrow().getLooseUnits();
    }

    @Test
    @DisplayName("starting a session snapshots the loose remainder alongside the pack count")
    void sessionSnapshotsLooseRemainder() {
        seedLooseBatch();
        String sessionId = stockAuditService.createSession(new CreateSessionRequest(null)).id();
        flushAndClear();

        var item = itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(i -> looseBatchId.equals(i.getInventoryId())).findFirst().orElseThrow();
        assertThat(item.getExpectedLooseUnits()).isEqualTo(4);
        assertThat(item.getCountedLooseUnits()).isNull();
        assertThat(item.getVarianceLooseUnits()).isNull();
    }

    @Test
    @DisplayName("approving a loose-remainder shortfall corrects looseUnits without touching the pack count")
    void approvalAppliesLooseShortfall() {
        seedLooseBatch();
        // Count the shared pack-only batch exactly too (no variance there) — every item in the
        // session needs a countedQty before it can be completed, loose one included.
        String sessionId = sessionCountedAt(100);
        String itemId = itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(i -> looseBatchId.equals(i.getInventoryId())).findFirst().orElseThrow().getId();
        // Pack count matches exactly (10); only the loose remainder is short — 2 tablets
        // physically missing from the 4 the system expected.
        stockAuditService.updateItem(sessionId, itemId, new UpdateItemRequest(10, 2, null));
        flushAndClear();
        stockAuditService.completeSession(sessionId, new CompleteSessionRequest(null));
        flushAndClear();

        stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null));
        flushAndClear();

        Inventory batch = inventoryRepository.findById(looseBatchId).orElseThrow();
        assertThat(batch.getQuantity()).as("pack count matched — must not have moved").isEqualTo(10);
        assertThat(batch.getLooseUnits()).as("2 loose tablets were missing").isEqualTo(2);

        String moveBaseUnit = (String) entityManager.createQuery(
                        "SELECT m.baseUnit FROM InventoryMovement m WHERE m.inventoryId = :id AND m.referenceType = 'STOCK_AUDIT'")
                .setParameter("id", looseBatchId).getSingleResult();
        assertThat(moveBaseUnit).as("the loose-variance ledger row is tagged in tablets, not packs").isEqualTo("TABLET");
    }

    @Test
    @DisplayName("leaving the loose field uncounted does not wipe out a real loose remainder at approval")
    void uncountedLooseFieldLeavesRemainderUntouched() {
        seedLooseBatch();
        // sessionCountedAt counts the shared pack-only batch exactly (no variance there —
        // irrelevant to this test); separately, only the PACK count is entered for the loose
        // batch below — its loose box is never touched, as it would not be for the
        // overwhelming majority of a pharmacy's medicines.
        String sessionId = sessionCountedAt(100);
        String itemId = itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(i -> looseBatchId.equals(i.getInventoryId())).findFirst().orElseThrow().getId();
        stockAuditService.updateItem(sessionId, itemId, new UpdateItemRequest(10, null, null));
        flushAndClear();
        stockAuditService.completeSession(sessionId, new CompleteSessionRequest(null));
        flushAndClear();

        stockAuditService.approveSession(sessionId, new ApproveSessionRequest(null));
        flushAndClear();

        assertThat(looseStock())
                .as("nobody counted the loose remainder, so it must be exactly what it was before")
                .isEqualTo(4);
    }

    @Test
    @DisplayName("a loose-only variance (packs matched exactly) still counts as a variance the audit must surface")
    void looseOnlyVarianceIsSurfaced() {
        seedLooseBatch();
        String sessionId = stockAuditService.createSession(new CreateSessionRequest(null)).id();
        flushAndClear();
        stockAuditService.startSession(sessionId);
        flushAndClear();
        String itemId = itemRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(i -> looseBatchId.equals(i.getInventoryId())).findFirst().orElseThrow().getId();
        // Packs match (10); loose remainder is one MORE than expected (5 found, not 4) — a
        // surplus with zero pack variance, which the old (pack-only) variance query would
        // have missed entirely.
        stockAuditService.updateItem(sessionId, itemId, new UpdateItemRequest(10, 5, null));
        flushAndClear();

        VarianceSummaryResponse summary = stockAuditService.getVarianceSummary(sessionId);
        var adjustment = summary.adjustments().stream()
                .filter(a -> looseBatchId.equals(a.inventoryId())).findFirst()
                .orElseThrow(() -> new AssertionError("loose-only variance did not appear in the variance summary"));
        assertThat(adjustment.varianceQty()).isEqualTo(0);
        assertThat(adjustment.varianceLooseUnits()).isEqualTo(1);
        assertThat(adjustment.looseDirection()).isEqualTo("IN");
    }

    @Test
    @DisplayName("the audit item reports this pharmacy's unitsPerPack override, not the catalogue value")
    void auditItemMedicineRefUsesEffectivePackSize() {
        seedLooseBatch(); // catalogue unitsPerPack = 10
        PharmacyMedicineOverride override = PharmacyMedicineOverride.create(pharmacyId, looseMedicineId);
        override.applyLoosePos(true, 20); // this pharmacy counts 20 tablets to a strip
        overrideRepository.save(override);
        flushAndClear();

        String sessionId = stockAuditService.createSession(new CreateSessionRequest(null)).id();
        flushAndClear();

        var looseItem = stockAuditService.getSession(sessionId).items().stream()
                .filter(i -> i.inventory() != null && looseBatchId.equals(i.inventory().id()))
                .findFirst().orElseThrow();
        assertThat(looseItem.inventory().medicine().unitsPerPack())
                .as("override pack size (20) wins over the catalogue's (10)")
                .isEqualTo(20);
        assertThat(looseItem.inventory().medicine().baseUnit())
                .as("baseUnit is resolved, not left null")
                .isEqualTo("TABLET");
    }
}
