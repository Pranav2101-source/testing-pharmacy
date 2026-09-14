package com.checkup.pharmacy.modules.dispensing;

import com.checkup.pharmacy.common.enums.BatchStatus;
import com.checkup.pharmacy.common.enums.DispensingStrategy;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlan;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlanRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
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

/**
 * The dispensing engine end to end against a real Postgres: batch ordering under
 * each strategy, multi-batch allocation, exclusion of non-sellable stock, the
 * per-invoice strategy snapshot, and that a strategy change never rewrites history.
 */
@Transactional
class DispensingIT extends AbstractPostgresIT {

    @Autowired private DispensingService dispensingService;
    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String medicineId;
    private String userId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = Medicine.create("Amoxicillin 500", new BigDecimal("12"));
        medicine.setPackaging(10, "CAPSULE");
        medicineRepository.save(medicine);

        pharmacyId = pharmacy.getId();
        medicineId = medicine.getId();
        userId = user.getId();
        entityManager.flush();
        entityManager.clear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private Inventory batch(String number, int daysToExpiry, Instant createdAt, int packs) {
        Inventory inv = Inventory.create(pharmacyId, medicineId, number,
                Instant.now().plus(daysToExpiry, ChronoUnit.DAYS), packs,
                new BigDecimal("8.00"), new BigDecimal("20.00"), 5, 2);
        inv = inventoryRepository.save(inv);
        // createdAt is set by @PrePersist; force it so LIFA ordering is testable.
        entityManager.flush();
        entityManager.createNativeQuery("UPDATE inventory SET \"createdAt\" = :c WHERE id = :id")
                .setParameter("c", createdAt)
                .setParameter("id", inv.getId())
                .executeUpdate();
        entityManager.flush();
        entityManager.clear();
        return inventoryRepository.findById(inv.getId()).orElseThrow();
    }

    private DispensingPlan planFor(int pieces) {
        return dispensingService.plan(List.of(
                new DispensingPlanRequest.Line(medicineId, null, pieces, null)));
    }

    private void setStrategy(DispensingStrategy s) {
        Pharmacy p = pharmacyRepository.findById(pharmacyId).orElseThrow();
        p.setDispensingStrategy(s);
        pharmacyRepository.save(p);
        entityManager.flush();
        entityManager.clear();
    }

    private void allowLoose() {
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, medicineId);
        o.setAllowLooseSale(true);
        overrideRepository.save(o);
        entityManager.flush();
        entityManager.clear();
    }

    // ── ordering ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("LILA/FEFO takes the earliest-expiring batch first")
    void lilaFefoOrder() {
        Instant old = Instant.now().minus(30, ChronoUnit.DAYS);
        Instant recent = Instant.now().minus(1, ChronoUnit.DAYS);
        batch("SOON", 90, recent, 10);   // newer stock, expires sooner
        batch("LATER", 400, old, 10);    // older stock, expires later

        DispensingPlan plan = planFor(5);
        assertThat(plan.strategy()).isEqualTo("LILA_FEFO");
        assertThat(plan.lines().get(0).allocations().get(0).batchNumber()).isEqualTo("SOON");
    }

    @Test
    @DisplayName("LIFA takes the most recently received batch first")
    void lifaOrder() {
        setStrategy(DispensingStrategy.LIFA);
        Instant old = Instant.now().minus(30, ChronoUnit.DAYS);
        Instant recent = Instant.now().minus(1, ChronoUnit.DAYS);
        batch("SOON", 90, old, 10);      // expires sooner but received long ago
        batch("FRESH", 400, recent, 10); // received most recently

        DispensingPlan plan = planFor(5);
        assertThat(plan.strategy()).isEqualTo("LIFA");
        assertThat(plan.lines().get(0).allocations().get(0).batchNumber()).isEqualTo("FRESH");
    }

    @Test
    @DisplayName("expired, quarantined and damaged batches are never selected")
    void excludesNonSellableStock() {
        Instant t = Instant.now().minus(5, ChronoUnit.DAYS);
        Inventory expired = Inventory.create(pharmacyId, medicineId, "EXP",
                Instant.now().minus(1, ChronoUnit.DAYS), 10, new BigDecimal("8"), new BigDecimal("20"), 5, 2);
        inventoryRepository.save(expired);
        Inventory quarantined = batch("QTN", 200, t, 10);
        quarantined.setStatus(BatchStatus.QUARANTINE);
        inventoryRepository.save(quarantined);
        Inventory damaged = batch("DMG", 200, t, 10);
        damaged.setStatus(BatchStatus.DAMAGED);
        inventoryRepository.save(damaged);
        batch("GOOD", 300, t, 10);
        entityManager.flush();
        entityManager.clear();

        DispensingPlan plan = planFor(5);
        assertThat(plan.lines().get(0).allocations())
                .extracting(DispensingPlan.Allocation::batchNumber)
                .containsExactly("GOOD");
    }

    @Test
    @DisplayName("reserved stock is not offered to the plan")
    void respectsReservedQuantity() {
        Instant t = Instant.now().minus(2, ChronoUnit.DAYS);
        Inventory a = batch("A", 100, t, 3); // 3 packs = 30 pieces, but...
        a.reserve(3);                        // ...all reserved by another cart
        inventoryRepository.save(a);
        batch("B", 200, t, 5);
        entityManager.flush();
        entityManager.clear();

        DispensingPlan plan = planFor(20);
        assertThat(plan.lines().get(0).allocations())
                .extracting(DispensingPlan.Allocation::batchNumber)
                .containsExactly("B");
    }

    // ── allocation ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("a quantity larger than one batch is split across batches in order")
    void multiBatchSplit() {
        Instant t1 = Instant.now().minus(10, ChronoUnit.DAYS);
        Instant t2 = Instant.now().minus(5, ChronoUnit.DAYS);
        batch("FIRST", 100, t1, 2);   // 2 packs = 20 pieces
        batch("SECOND", 200, t2, 5);
        allowLoose();

        DispensingPlan.Line line = planFor(35).lines().get(0);
        assertThat(line.fullyAllocated()).isTrue();
        assertThat(line.dispensedPieces()).isEqualTo(35);
        assertThat(line.allocations()).hasSize(2);
        assertThat(line.allocations().get(0).batchNumber()).isEqualTo("FIRST");
        assertThat(line.allocations().get(1).batchNumber()).isEqualTo("SECOND");
    }

    @Test
    @DisplayName("insufficient stock is reported as a shortfall with a pharmacist-readable message")
    void reportsShortfall() {
        batch("ONLY", 100, Instant.now().minus(1, ChronoUnit.DAYS), 2); // 20 pieces
        allowLoose();

        DispensingPlan.Line line = planFor(50).lines().get(0);
        assertThat(line.fullyAllocated()).isFalse();
        assertThat(line.shortfallPieces()).isEqualTo(30);
        assertThat(line.dispensedPieces()).isEqualTo(20);
        assertThat(line.unmetReason()).isEqualTo("PARTIAL");
        assertThat(line.message()).contains("30").contains("short");
    }

    @Test
    @DisplayName("a multi-line plan resolves every line independently")
    void multiLinePlan() {
        Medicine other = Medicine.create("Cetirizine 10", new BigDecimal("12"));
        other.setPackaging(10, "TABLET");
        medicineRepository.save(other);
        batch("A", 90, Instant.now().minus(2, ChronoUnit.DAYS), 5);
        inventoryRepository.save(Inventory.create(pharmacyId, other.getId(), "C1",
                Instant.now().plus(120, ChronoUnit.DAYS), 3, new BigDecimal("8"), new BigDecimal("15"), 5, 2));
        entityManager.flush();
        entityManager.clear();

        DispensingPlan plan = dispensingService.plan(List.of(
                new DispensingPlanRequest.Line(medicineId, null, 6, null),
                new DispensingPlanRequest.Line(other.getId(), null, 90, null)));

        assertThat(plan.lines()).hasSize(2);
        assertThat(plan.lines().get(0).allocations().get(0).batchNumber()).isEqualTo("A");
        assertThat(plan.lines().get(0).fullyAllocated()).isTrue();
        assertThat(plan.lines().get(1).unmetReason()).isEqualTo("PARTIAL"); // only 30 in stock of 90 asked
        assertThat(plan.lines().get(1).shortfallPieces()).isEqualTo(60);
    }

    @Test
    @DisplayName("no sellable stock at all -> NO_STOCK with a clear message")
    void noStockMessage() {
        // no batches seeded
        DispensingPlan.Line line = planFor(10).lines().get(0);
        assertThat(line.allocations()).isEmpty();
        assertThat(line.unmetReason()).isEqualTo("NO_STOCK");
        assertThat(line.message()).contains("No in-date, sellable stock");
    }

    @Test
    @DisplayName("stock exists but under a full pack and loose is off -> NO_SELLABLE_UNIT with actionable message")
    void noSellableUnitMessage() {
        // 0 sealed packs, 4 loose pieces only, loose selling OFF for the medicine
        Inventory inv = Inventory.create(pharmacyId, medicineId, "SCRAP",
                Instant.now().plus(100, ChronoUnit.DAYS), 0, new BigDecimal("8"), new BigDecimal("20"), 5, 2);
        inv = inventoryRepository.save(inv);
        inv.restockLoose(4);
        inventoryRepository.save(inv);
        entityManager.flush();
        entityManager.clear();

        DispensingPlan.Line line = planFor(8).lines().get(0);
        assertThat(line.unmetReason()).isEqualTo("NO_SELLABLE_UNIT");
        assertThat(line.message()).contains("less than one full pack").contains("loose");
    }

    @Test
    @DisplayName("with loose selling off, a part-pack quantity rounds up to a whole pack")
    void roundsUpWhenLooseOff() {
        batch("PACKONLY", 100, Instant.now().minus(1, ChronoUnit.DAYS), 5);

        DispensingPlan.Line line = planFor(12).lines().get(0); // upp 10
        assertThat(line.allocations().get(0).saleUnit()).isEqualTo("PACK");
        assertThat(line.allocations().get(0).quantity()).isEqualTo(2); // 20 pieces
        assertThat(line.roundedUpToPieces()).isEqualTo(20);
    }

    @Test
    @DisplayName("a measured (mL) medicine rounds a part-bottle prescription up to whole bottles, phrased for a bottle")
    void measuredMedicineRoundsUpToWholeBottles() {
        // A 100 mL syrup, no loose selling — a 150 mL course cannot be half a bottle.
        Medicine syrup = Medicine.create("Cough Syrup 100ml", new BigDecimal("12"));
        syrup.setPackaging(100, "ML");
        medicineRepository.save(syrup);
        Inventory inv = Inventory.create(pharmacyId, syrup.getId(), "SYR1",
                Instant.now().plus(200, ChronoUnit.DAYS), 5,
                new BigDecimal("40.00"), new BigDecimal("80.00"), 5, 2);
        inventoryRepository.save(inv);
        entityManager.flush();
        entityManager.clear();

        DispensingPlan.Line line = dispensingService.plan(List.of(
                new DispensingPlanRequest.Line(syrup.getId(), null, 150, null))).lines().get(0);

        assertThat(line.allocations().get(0).saleUnit()).isEqualTo("PACK");
        assertThat(line.allocations().get(0).quantity()).isEqualTo(2);   // 2 sealed bottles
        assertThat(line.roundedUpToPieces()).isEqualTo(200);
        assertThat(line.unmetReason()).isEqualTo("ROUNDED_UP");
        // Phrased for a sealed bottle — never "cut a strip" / "enable loose selling".
        assertThat(line.message()).contains("bottle").doesNotContain("loose").doesNotContain("strip");
    }

    @Test
    @DisplayName("the medicine's free-text catalogue packSize is carried onto every allocation (for the cart's Pack column)")
    void allocationCarriesTheCataloguePackSize() {
        Medicine syrup = Medicine.create("Grilinctus Syrup", new BigDecimal("12"));
        syrup.applyFields(null, null, null, null, null, null, new BigDecimal("12"),
                "Syrup", null, "Bottle", "100ml bottle");
        syrup.setPackaging(100, "ML");
        medicineRepository.save(syrup);
        Inventory inv = Inventory.create(pharmacyId, syrup.getId(), "GS1",
                Instant.now().plus(200, ChronoUnit.DAYS), 4,
                new BigDecimal("40.00"), new BigDecimal("80.00"), 5, 2);
        inventoryRepository.save(inv);
        entityManager.flush();
        entityManager.clear();

        DispensingPlan.Line line = dispensingService.plan(List.of(
                new DispensingPlanRequest.Line(syrup.getId(), null, 100, null))).lines().get(0);

        assertThat(line.allocations()).singleElement().satisfies(a -> {
            assertThat(a.packSize()).isEqualTo("100ml bottle");
            assertThat(a.saleUnit()).isEqualTo("PACK");
            assertThat(a.quantity()).isEqualTo(1);
            assertThat(a.baseUnit()).isEqualTo("ML");
        });
    }

    @Test
    @DisplayName("a medicine with no catalogue packSize carries null — the frontend computes a label from unitsPerPack")
    void allocationPackSizeIsNullWhenTheCatalogueHasNone() {
        batch("NO-PACKSIZE", 200, Instant.now().minus(1, ChronoUnit.DAYS), 3);

        DispensingPlan.Line line = planFor(10).lines().get(0); // seed medicine: no packSize set

        assertThat(line.allocations().get(0).packSize()).isNull();
    }

    @Test
    @DisplayName("with loose selling on, a part-pack quantity is dispensed as loose pieces")
    void loosePiecesWhenLooseOn() {
        batch("LOOSEOK", 100, Instant.now().minus(1, ChronoUnit.DAYS), 5);
        allowLoose();

        DispensingPlan.Line line = planFor(12).lines().get(0);
        assertThat(line.allocations().get(0).saleUnit()).isEqualTo("LOOSE");
        assertThat(line.allocations().get(0).quantity()).isEqualTo(12);
        assertThat(line.roundedUpToPieces()).isNull();
    }

    // ── strategy snapshot / history ──────────────────────────────────────────

    @Test
    @DisplayName("createInvoice snapshots the strategy; changing it later does not touch the past bill")
    void strategySnapshotIsImmutable() {
        Inventory b = batch("B1", 200, Instant.now().minus(2, ChronoUnit.DAYS), 10);
        CreateInvoiceRequest req = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(b.getId(), 2, null, BigDecimal.ZERO, null)));
        InvoiceResponse invoice = billingService.createInvoice(req);
        assertThat(invoice.dispensingStrategy()).isEqualTo("LILA_FEFO");
        assertThat(invoice.items().get(0).batchAutoSelected()).isTrue();
        entityManager.flush();
        entityManager.clear();

        setStrategy(DispensingStrategy.LIFA);

        String stored = (String) entityManager.createNativeQuery(
                        "SELECT \"dispensingStrategy\"::text FROM invoices WHERE id = :id")
                .setParameter("id", invoice.id()).getSingleResult();
        assertThat(stored).as("the past bill keeps the strategy it was made under").isEqualTo("LILA_FEFO");
    }

    @Test
    @DisplayName("a hand-picked batch is recorded as a pharmacist override")
    void manualBatchOverrideIsRecorded() {
        Inventory b = batch("MANUAL", 200, Instant.now().minus(2, ChronoUnit.DAYS), 10);
        CreateInvoiceRequest req = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(b.getId(), 1, null, BigDecimal.ZERO, null, "PACK", null, false)));
        InvoiceResponse invoice = billingService.createInvoice(req);
        assertThat(invoice.items().get(0).batchAutoSelected()).isFalse();
    }

    @Test
    @DisplayName("topBatchPerMedicine (the Quick Add / Repeat Last Bill primitive) follows the strategy")
    void topBatchPerMedicineFollowsStrategy() {
        Instant old = Instant.now().minus(20, ChronoUnit.DAYS);
        Instant recent = Instant.now().minus(1, ChronoUnit.DAYS);
        batch("SOON", 90, old, 10);      // expires sooner, received long ago
        batch("FRESH", 400, recent, 10); // expires later, received recently
        List<Inventory> candidates = inventoryRepository.findSellableBatchesForMedicines(
                pharmacyId, List.of(medicineId), Instant.now());

        assertThat(dispensingService.topBatchPerMedicine(candidates).get(medicineId).getBatchNumber())
                .as("LILA/FEFO — soonest expiry").isEqualTo("SOON");

        setStrategy(DispensingStrategy.LIFA);
        assertThat(dispensingService.topBatchPerMedicine(candidates).get(medicineId).getBatchNumber())
                .as("LIFA — most recently received").isEqualTo("FRESH");
    }

    @Test
    @DisplayName("updateStrategy persists the new value and rejects an unknown one")
    void updateStrategy() {
        dispensingService.updateStrategy("LIFA");
        entityManager.flush();
        entityManager.clear();
        assertThat(pharmacyRepository.findById(pharmacyId).orElseThrow().getDispensingStrategy())
                .isEqualTo(DispensingStrategy.LIFA);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> dispensingService.updateStrategy("SOMETHING"))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
    }
}
