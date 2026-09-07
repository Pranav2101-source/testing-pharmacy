package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.dto.MedicineResponse;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Billing search's "in-stock first" ranking (see {@code MedicineService#quickSearch}):
 * one batched stock join over the whole result page (never per-row — see
 * {@code InventoryRepository#findStockForEffectiveMedicineIds}/{@code
 * #findStockForLocalMedicineIds}), a stable partition that moves every in-stock hit
 * ahead of every out-of-stock one without touching the underlying text-match order, and
 * the quantity/loose/price fields the billing combobox displays per result.
 *
 * <p>Two correctness properties matter most here and get a test each rather than being
 * assumed:
 * <ul>
 *   <li>{@code quantity} (whole packs) and {@code looseUnits} (a cut-strip remainder)
 *       are two independent counters on the same {@code Inventory} row — see {@link
 *       Inventory#availablePieces} — so summing each independently across batches and
 *       combining once at the medicine level ({@code availableQuantity * unitsPerPack +
 *       looseUnitsOnHand}) can never double-count either one. {@link
 *       #stockQuantityAndSellableUnitsAcrossMultipleBatchesNoDoubleCount()} pins the
 *       exact numbers across two batches, one with a reservation, one with a loose
 *       remainder.
 *   <li>A batch counts toward exactly one search result: its own {@code medicineId}
 *       directly, XOR (via a {@code LINKED} local medicine's {@code linkedMedicineId})
 *       the catalogue medicine it was matched to — never both, and a {@code LINKED}
 *       local medicine never also surfaces as its own separate row. {@link
 *       #linkedLocalMedicineStockRollsUpWithoutDuplicationOrDoubleCounting()} pins
 *       that a catalogue medicine's own batch plus a linked local medicine's batch sum
 *       to exactly one result with the combined total, not two results or a doubled one.
 * </ul>
 */
@Transactional
class BillingSearchStockRankingIT extends AbstractPostgresIT {

    @Autowired private MedicineService medicineService;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private PharmacyMedicineRepository pharmacyMedicineRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private PharmacyMedicineService pharmacyMedicineService;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private BillingService billingService;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        flushAndClear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static Instant future(int days) {
        return Instant.now().plus(days, ChronoUnit.DAYS);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private Medicine medicine(String name, String genericName, BigDecimal gstRate) {
        Medicine m = Medicine.create(name, gstRate);
        m.applyFields(genericName, null, null, null, null, "3004", gstRate, "Tablet", "500mg", "strip", "10s");
        return medicineRepository.save(m);
    }

    private PharmacyMedicine localMedicine(String name, BigDecimal gstRate) {
        return pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, name, null, null,
                null, null, null, "3004", gstRate, null));
    }

    private void allowLoose(String medicineId, int unitsPerPack) {
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, medicineId);
        o.applyLoosePos(true, unitsPerPack);
        overrideRepository.save(o);
    }

    /** A batch — exactly one of medicineId/localMedicineId is set, per {@link Inventory}'s own invariant. */
    private Inventory batch(String medicineId, String localMedicineId, String batchNumber,
                            int quantity, int looseUnits, int reservedQuantity,
                            BigDecimal mrp, Instant expiry) {
        Inventory inv = Inventory.create(pharmacyId, medicineId, localMedicineId, batchNumber, expiry,
                quantity, new BigDecimal("10.00"), mrp, 10, 5);
        if (looseUnits > 0) inv.setLooseUnits(looseUnits);
        if (reservedQuantity > 0) inv.reserve(reservedQuantity);
        return inventoryRepository.save(inv);
    }

    private String walkInCustomerId() {
        return customerRepository.save(Customer.create(pharmacyId, "Walk-in")).getId();
    }

    private InvoiceResponse bill(String inventoryId, int qty, String saleUnit) {
        var item = new InvoiceItemRequest(inventoryId, qty, null, BigDecimal.ZERO, null, saleUnit);
        return billingService.createInvoice(new CreateInvoiceRequest(walkInCustomerId(), null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, List.of(item)));
    }

    // ── 1. Ranking ───────────────────────────────────────────────────────────

    @Test
    @DisplayName("in-stock results rank ahead of out-of-stock ones, even when the out-of-stock hit has the "
            + "stronger raw text match — without disturbing text-match order within each group")
    void inStockRanksAheadOfOutOfStockPreservingTextMatchOrder() {
        String term = "Rankterm" + unique();

        // Strongest possible text match (name starts with the term) but zero stock.
        Medicine outOfStockStrong = medicine(term + " Strong OOS", null, new BigDecimal("12"));
        // Weak text match (genericName only, a lower tier than a name hit) but in stock.
        Medicine inStockWeak = medicine("Weak Brand " + unique(), term, new BigDecimal("12"));
        batch(inStockWeak.getId(), null, "WEAK-1", 5, 0, 0, new BigDecimal("25.00"), future(90));
        // Strongest text match AND in stock — must come first.
        Medicine inStockStrong = medicine(term + " InStock", null, new BigDecimal("12"));
        batch(inStockStrong.getId(), null, "STRONG-1", 5, 0, 0, new BigDecimal("25.00"), future(90));
        flushAndClear();

        List<MedicineResponse> results = medicineService.quickSearch(term, 20, true);
        List<String> ids = results.stream().map(MedicineResponse::id).toList();

        int idxStrongInStock = ids.indexOf(inStockStrong.getId());
        int idxWeakInStock = ids.indexOf(inStockWeak.getId());
        int idxStrongOOS = ids.indexOf(outOfStockStrong.getId());
        assertThat(idxStrongInStock).isGreaterThanOrEqualTo(0);
        assertThat(idxWeakInStock).isGreaterThanOrEqualTo(0);
        assertThat(idxStrongOOS).isGreaterThanOrEqualTo(0);

        assertThat(idxStrongInStock).as("in-stock strong match must be first")
                .isLessThan(idxWeakInStock);
        assertThat(idxWeakInStock).as("an in-stock weak match must still beat an out-of-stock strong match")
                .isLessThan(idxStrongOOS);

        assertThat(results.get(idxStrongInStock).inStock()).isTrue();
        assertThat(results.get(idxWeakInStock).inStock()).isTrue();
        assertThat(results.get(idxStrongOOS).inStock()).isFalse();
        assertThat(results.get(idxStrongOOS).availableQuantity()).isZero();
    }

    // ── 2. Stock quantity / sellable units — no double counting ────────────────

    @Test
    @DisplayName("available quantity and sellable units sum correctly across multiple batches — "
            + "packs and loose units are each counted once, and a reservation is subtracted once")
    void stockQuantityAndSellableUnitsAcrossMultipleBatchesNoDoubleCount() {
        String term = "Stockterm" + unique();
        Medicine med = medicine(term + " Multi Batch", null, new BigDecimal("12"));
        allowLoose(med.getId(), 10);

        // Batch 1: 5 whole packs, nothing loose, nothing reserved. Expires later.
        batch(med.getId(), null, "B1", 5, 0, 0, new BigDecimal("20.00"), future(100));
        // Batch 2: 3 packs, 4 loose pieces already cut from an opened pack, 1 pack held
        // by another in-progress cart. Expires sooner — this is the FEFO batch.
        batch(med.getId(), null, "B2", 3, 4, 1, new BigDecimal("18.00"), future(30));
        flushAndClear();

        var results = medicineService.quickSearch(term, 10, true);
        var found = results.stream().filter(m -> m.id().equals(med.getId())).findFirst().orElseThrow();

        assertThat(found.inStock()).isTrue();
        assertThat(found.allowLooseSale()).isTrue();
        // (5 - 0) + (3 - 1) = 7 whole packs — the reservation is subtracted once, not per-batch double-subtracted.
        assertThat(found.availableQuantity()).as("packs, reservation subtracted exactly once").isEqualTo(7);
        // 0 + 4 = 4 — summed once across batches, independent of how many packs each batch has.
        assertThat(found.looseUnitsOnHand()).as("loose remainder summed once across batches").isEqualTo(4);
        // 7 packs * 10 units/pack + 4 loose = 74. A double-count bug (e.g. applying loose units
        // per batch instead of once, or not subtracting the reservation) would produce a
        // different number here, so this pins the exact arithmetic, not just "some positive value".
        assertThat(found.sellableUnits()).as("packs*unitsPerPack + loose, each term counted once").isEqualTo(74);
        // FEFO batch (soonest expiry) is B2 at 18.00, not B1's 20.00 or an average of the two.
        assertThat(found.price()).isEqualByComparingTo("18.00");
    }

    // ── 3. Loose selling ────────────────────────────────────────────────────

    @Test
    @DisplayName("a medicine with loose selling disabled reports no sellable-units figure, "
            + "even though it has ordinary pack stock")
    void nonLooseMedicineReportsNoSellableUnits() {
        String term = "Nolooseterm" + unique();
        Medicine med = medicine(term + " Pack Only", null, new BigDecimal("12"));
        batch(med.getId(), null, "PO-1", 6, 0, 0, new BigDecimal("30.00"), future(60));
        flushAndClear();

        var results = medicineService.quickSearch(term, 10, true);
        var found = results.stream().filter(m -> m.id().equals(med.getId())).findFirst().orElseThrow();

        assertThat(found.inStock()).isTrue();
        assertThat(found.availableQuantity()).isEqualTo(6);
        assertThat(found.allowLooseSale()).isFalse();
        assertThat(found.sellableUnits()).as("not loose-sellable — no meaningful unit total to show").isNull();
    }

    // ── 4. Local (unlinked) medicine — own stock, no cross-pollution ──────────

    @Test
    @DisplayName("an unlinked local medicine appears as its own search result with its own stock, "
            + "and never rolls into any catalogue medicine's numbers")
    void unlinkedLocalMedicineShowsOwnStockOnly() {
        String term = "Localterm" + unique();
        PharmacyMedicine local = localMedicine(term + " Local Only", new BigDecimal("12"));
        batch(null, local.getId(), "L1", 6, 0, 0, new BigDecimal("15.00"), future(50));
        flushAndClear();

        var results = medicineService.quickSearch(term, 10, true);
        var found = results.stream().filter(m -> m.id().equals(local.getId())).findFirst().orElseThrow();

        assertThat(found.isLocal()).isTrue();
        assertThat(found.inStock()).isTrue();
        assertThat(found.availableQuantity()).isEqualTo(6);
        assertThat(found.price()).isEqualByComparingTo("15.00");
        assertThat(found.sellableUnits()).as("no loose-sale concept for a not-yet-catalogued local medicine").isNull();
    }

    // ── 5. Linked local medicine — rollup without duplication or double counting ─

    @Test
    @DisplayName("a LINKED local medicine's stock rolls into its catalogue medicine's single search result — "
            + "no duplicate row, no double count")
    void linkedLocalMedicineStockRollsUpWithoutDuplicationOrDoubleCounting() {
        String term = "Linkterm" + unique();
        Medicine catalogue = medicine(term + " Catalogue", null, new BigDecimal("12"));
        batch(catalogue.getId(), null, "C1", 5, 0, 0, new BigDecimal("30.00"), future(90));
        flushAndClear();

        // Flushed separately from its own batch below: with two Inventory rows pending at
        // once (this one's medicineId FK, the next one's localMedicineId FK), Hibernate's
        // insert-dependency ordering doesn't reliably see that a NEW localMedicineId still
        // needs its PharmacyMedicine parent flushed first — Inventory.localMedicine is a
        // read-only (insertable=false) association (see Inventory's own javadoc on why: the
        // real FK is the plain medicineId/localMedicineId scalar), so it isn't picked up the
        // same way a normal owning association would be.
        PharmacyMedicine local = localMedicine(term + " GRN Local", new BigDecimal("12"));
        flushAndClear();
        batch(null, local.getId(), "L1", 3, 0, 0, new BigDecimal("28.00"), future(10));
        flushAndClear();
        pharmacyMedicineService.confirmLink(local.getId(), catalogue.getId());
        flushAndClear();

        var results = medicineService.quickSearch(term, 10, true);

        assertThat(results).filteredOn(m -> m.id().equals(catalogue.getId())).hasSize(1);
        assertThat(results).as("a LINKED local medicine must not also surface as its own separate row")
                .noneMatch(m -> m.id().equals(local.getId()));

        var found = results.stream().filter(m -> m.id().equals(catalogue.getId())).findFirst().orElseThrow();
        // 5 (the catalogue medicine's own direct batch) + 3 (via the linked local medicine's
        // batch) = 8, counted exactly once each — not 5, not 3, not 16.
        assertThat(found.availableQuantity()).as("direct + linked-local stock summed exactly once each").isEqualTo(8);
        // FEFO price: the linked local batch expires sooner (10 days) than the direct one (90 days).
        assertThat(found.price()).isEqualByComparingTo("28.00");
    }

    // ── 6. Pharmacy isolation ──────────────────────────────────────────────

    @Test
    @DisplayName("search stock is never mixed between pharmacies")
    void searchStockNeverMixesBetweenPharmacies() {
        String term = "Isoterm" + unique();
        Medicine shared = medicine(term + " Shared", null, new BigDecimal("12"));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        inventoryRepository.save(Inventory.create(other.getId(), shared.getId(), "OTHER-1",
                future(100), 999, new BigDecimal("10.00"), new BigDecimal("50.00"), 10, 5));
        flushAndClear();

        // Still authenticated as this test's own pharmacy (seed()) — the other pharmacy's
        // 999-unit batch must be completely invisible here.
        var results = medicineService.quickSearch(term, 10, true);
        var found = results.stream().filter(m -> m.id().equals(shared.getId())).findFirst().orElseThrow();

        assertThat(found.inStock()).isFalse();
        assertThat(found.availableQuantity()).isZero();
        assertThat(found.price()).isNull();
    }

    // ── 7. Adding the top search result to billing ─────────────────────────

    @Test
    @DisplayName("the top-ranked in-stock search result is a real batch billing can sell, "
            + "at the same price search showed, via the existing FEFO batch-selection path")
    void topSearchResultCanBeBilled() {
        String term = "Billterm" + unique();
        Medicine med = medicine(term + " Billable", null, new BigDecimal("12"));
        Inventory theBatch = batch(med.getId(), null, "BILL-1", 4, 0, 0, new BigDecimal("45.00"), future(60));
        flushAndClear();

        var results = medicineService.quickSearch(term, 10, true);
        var found = results.stream().filter(m -> m.id().equals(med.getId())).findFirst().orElseThrow();
        assertThat(found.inStock()).isTrue();
        assertThat(found.availableQuantity()).isEqualTo(4);
        assertThat(found.price()).isEqualByComparingTo("45.00");

        // The same FEFO lookup the billing combobox's batch picker (and Quick Add) already
        // use — this test doesn't re-derive batch selection, it confirms the batch search
        // showed is the one FEFO actually offers.
        List<Inventory> fefo = inventoryRepository.findFefoCandidates(
                pharmacyId, med.getId(), Instant.now(), 1, PageRequest.of(0, 1));
        assertThat(fefo).hasSize(1);
        assertThat(fefo.get(0).getId()).isEqualTo(theBatch.getId());

        InvoiceResponse invoice = bill(theBatch.getId(), 1, "PACK");
        var line = invoice.items().get(0);
        assertThat(line.rate()).as("billed at the same MRP the search result showed")
                .isEqualByComparingTo(found.price());

        flushAndClear();
        Inventory reloaded = inventoryRepository.findById(theBatch.getId()).orElseThrow();
        assertThat(reloaded.getQuantity()).isEqualTo(3);
    }
}
