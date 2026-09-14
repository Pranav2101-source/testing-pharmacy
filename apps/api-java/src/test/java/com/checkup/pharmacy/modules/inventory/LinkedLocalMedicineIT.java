package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.inventory.dto.InventoryResponse;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineService;
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
 * The local-medicine inventory enrichment gap: a batch received against a {@link
 * PharmacyMedicine} local identity that has since been confirmed {@code LINKED} to the
 * global catalogue (see {@code PharmacyMedicineService#confirmLink}) must be enriched
 * and billed exactly like a batch received against the catalogue directly — loose-sale
 * eligibility, pack size, GST/HSN, all of it. Before {@link EffectiveMedicine} existed,
 * {@code InventoryService.enrich()} and {@code BillingService} only ever looked at
 * {@code Inventory.medicine} (always null for a local batch) or the bare local-medicine
 * placeholder, so a linked batch never got the loose/GST behaviour its pharmacy had
 * configured on the catalogue side — see the read (enrichment) and write (billing)
 * assertions in every test below.
 *
 * <p>PENDING/SUGGESTED/KEPT_LOCAL must be unaffected — see {@link
 * #unlinkedLocalMedicineKeepsExistingLocalOnlyBehaviour()} — and a dangling link (the
 * catalogue target has since gone missing) must degrade gracefully rather than 500 —
 * see {@link #linkedButTargetMedicineGoneFallsBackToLocalOnlyBehaviour()}.
 */
@Transactional
class LinkedLocalMedicineIT extends AbstractPostgresIT {

    @Autowired private InventoryService inventoryService;
    @Autowired private BillingService billingService;
    @Autowired private PharmacyMedicineService pharmacyMedicineService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private PharmacyMedicineRepository pharmacyMedicineRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private com.checkup.pharmacy.modules.customer.CustomerRepository customerRepository;
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

    private static Instant future() {
        return Instant.now().plus(365, ChronoUnit.DAYS);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    /** Catalogue medicine: 10 units/pack, MRP 20 => per-piece MRP 2.00 (matches LooseDispensingIT). */
    private Medicine catalogueMedicine(String name, BigDecimal gstRate) {
        Medicine m = Medicine.create(name, gstRate);
        m.setPackaging(10, "TABLET");
        m.applyFields(null, null, null, null, null, "3004", gstRate, "TABLET", "10mg", "STRIP", "10s");
        return medicineRepository.save(m);
    }

    private PharmacyMedicine localMedicine(String name, BigDecimal gstRate) {
        return pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, name, null, null,
                null, null, null, "3004", gstRate, null));
    }

    /** 10 packs @ MRP 20.00 => 100 pieces, per-piece MRP 2.00 — same shape as LooseDispensingIT. */
    private Inventory localBatch(String localMedicineId, String batchNumber) {
        return inventoryRepository.save(Inventory.create(pharmacyId, null, localMedicineId, batchNumber, future(),
                10, new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5));
    }

    private void allowLoose(String catalogueMedicineId, int unitsPerPack) {
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, catalogueMedicineId);
        o.applyLoosePos(true, unitsPerPack);
        overrideRepository.save(o);
        flushAndClear();
    }

    private String walkInCustomerId() {
        return customerRepository.save(com.checkup.pharmacy.modules.customer.Customer.create(pharmacyId, "Walk-in")).getId();
    }

    private InvoiceResponse bill(String inventoryId, int qty, String saleUnit) {
        var item = new InvoiceItemRequest(inventoryId, qty, null, BigDecimal.ZERO, null, saleUnit);
        return billingService.createInvoice(new CreateInvoiceRequest(walkInCustomerId(), null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, List.of(item)));
    }

    // ── 1. Linked local medicine + loose selling enabled ────────────────────

    @Test
    @DisplayName("linked local medicine + loose enabled: enrichment shows LOOSE OK and billing sells loose")
    void linkedLocalMedicineWithLooseEnabled() {
        Medicine catalogue = catalogueMedicine("Cetirizine 10mg Tablet " + unique(), new BigDecimal("12"));
        PharmacyMedicine local = localMedicine("Cetirizine", new BigDecimal("12"));
        Inventory batch = localBatch(local.getId(), "CET-1");
        allowLoose(catalogue.getId(), 10);
        pharmacyMedicineService.confirmLink(local.getId(), catalogue.getId());
        flushAndClear();

        // ── Read side: InventoryService.enrich() ──
        InventoryResponse resp = inventoryService.getById(batch.getId());
        assertThat(resp.medicine().id()).as("resolves to the LINKED catalogue medicine, not the local placeholder")
                .isEqualTo(catalogue.getId());
        assertThat(resp.medicine().unitsPerPack()).isEqualTo(10);
        assertThat(resp.medicine().allowLooseSale()).isTrue();
        assertThat(resp.medicine().gstRate()).isEqualByComparingTo("12");

        // ── Write side: BillingService actually sells it loose ──
        InvoiceResponse invoice = bill(batch.getId(), 8, "LOOSE");
        var line = invoice.items().get(0);
        assertThat(line.saleUnit()).isEqualTo("LOOSE");
        assertThat(line.rate()).as("per-piece price, not the full strip MRP").isEqualByComparingTo("2.00");

        flushAndClear();
        Inventory reloaded = inventoryRepository.findById(batch.getId()).orElseThrow();
        assertThat(reloaded.getQuantity()).as("one pack broken open").isEqualTo(9);
        assertThat(reloaded.getLooseUnits()).as("10 - 8 pieces left loose").isEqualTo(2);
    }

    // ── 2. Linked local medicine + loose selling disabled ───────────────────

    @Test
    @DisplayName("linked local medicine + loose disabled: enrichment shows no loose, a loose sale is refused, "
            + "a pack sale still picks up the catalogue's GST override")
    void linkedLocalMedicineWithLooseDisabled() {
        // Local medicine's own GST (8) deliberately differs from the catalogue's (12) so a
        // resolved gstRate of 12 on enrichment can only mean the link was actually followed —
        // not the local placeholder's own rate coming through unchanged.
        Medicine catalogue = catalogueMedicine("Ibuprofen 400 " + unique(), new BigDecimal("12"));
        PharmacyMedicine local = localMedicine("Ibuprofen", new BigDecimal("8"));
        Inventory batch = localBatch(local.getId(), "IBU-1");
        // A GST-only override — no loose opt-in — proves override behaviour flows through the
        // link independently of loose selling. InventoryResponse's own gstRate is always the
        // CATALOGUE rate, override or not (billing is where a GST override actually applies —
        // see BillingService's gstOverrideByMedicineId), so the override is only asserted at
        // the billing line below, not on the enrichment response.
        PharmacyMedicineOverride o = PharmacyMedicineOverride.create(pharmacyId, catalogue.getId());
        o.update(new BigDecimal("5"), null, null);
        overrideRepository.save(o);
        pharmacyMedicineService.confirmLink(local.getId(), catalogue.getId());
        flushAndClear();

        InventoryResponse resp = inventoryService.getById(batch.getId());
        assertThat(resp.medicine().allowLooseSale()).isFalse();
        assertThat(resp.medicine().gstRate()).as("resolves to the linked catalogue medicine's own rate")
                .isEqualByComparingTo("12");

        assertThatThrownBy(() -> bill(batch.getId(), 3, "LOOSE"))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("Loose selling is not enabled");

        InvoiceResponse invoice = bill(batch.getId(), 2, "PACK");
        var line = invoice.items().get(0);
        assertThat(line.gstRate()).as("the pack sale still bills at the linked catalogue's override GST")
                .isEqualByComparingTo("5");
        assertThat(line.hsnCode()).isEqualTo("3004");
    }

    // ── 3. Unlinked local medicine — regression guard on existing behaviour ─

    @Test
    @DisplayName("unlinked local medicine (PENDING) keeps its existing local-only behaviour unchanged")
    void unlinkedLocalMedicineKeepsExistingLocalOnlyBehaviour() {
        PharmacyMedicine local = localMedicine("PCM Local " + unique(), new BigDecimal("12"));
        Inventory batch = localBatch(local.getId(), "LOC-1");
        flushAndClear();

        assertThat(local.getMatchStatus()).isEqualTo(MedicineMatchStatus.PENDING);

        InventoryResponse resp = inventoryService.getById(batch.getId());
        assertThat(resp.medicine().id()).isEqualTo(local.getId());
        assertThat(resp.medicine().unitsPerPack()).isNull();
        assertThat(resp.medicine().allowLooseSale()).isFalse();
        assertThat(resp.medicine().gstRate()).isEqualByComparingTo("12");

        assertThatThrownBy(() -> bill(batch.getId(), 2, "LOOSE"))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("Loose selling is not enabled");

        InvoiceResponse invoice = bill(batch.getId(), 2, "PACK");
        assertThat(invoice.items().get(0).gstRate()).isEqualByComparingTo("12");
    }

    // ── 4. Billing / remaining-stock behaviour across two sales on a linked batch ─

    @Test
    @DisplayName("remaining stock tracks correctly across a pack sale then a loose sale on a linked batch, "
            + "and the batch is never repointed to the catalogue medicineId")
    void billingRemainingStockOnLinkedBatch() {
        Medicine catalogue = catalogueMedicine("Amoxicillin 250 " + unique(), new BigDecimal("12"));
        PharmacyMedicine local = localMedicine("Amoxicillin", new BigDecimal("12"));
        Inventory batch = localBatch(local.getId(), "AMX-1");
        allowLoose(catalogue.getId(), 10);
        pharmacyMedicineService.confirmLink(local.getId(), catalogue.getId());
        flushAndClear();

        // Sale 1: one whole pack (10 packs -> 9).
        bill(batch.getId(), 1, "PACK");
        flushAndClear();
        Inventory afterPack = inventoryRepository.findById(batch.getId()).orElseThrow();
        assertThat(afterPack.getQuantity()).isEqualTo(9);
        assertThat(afterPack.getLooseUnits()).isEqualTo(0);

        // Sale 2: 6 loose pieces, cut from a second pack (9 -> 8 packs, 4 pieces left loose).
        bill(batch.getId(), 6, "LOOSE");
        flushAndClear();
        Inventory afterLoose = inventoryRepository.findById(batch.getId()).orElseThrow();
        assertThat(afterLoose.getQuantity()).isEqualTo(8);
        assertThat(afterLoose.getLooseUnits()).isEqualTo(4);

        // Linking and billing are both additive — see PharmacyMedicine#confirmLink and
        // GrnLocalMedicineIT#confirmLinkNeverRewritesHistoricalRows. The batch must still
        // carry its own local identity, never the catalogue's, after two sales through the link.
        assertThat(afterLoose.getMedicineId()).isNull();
        assertThat(afterLoose.getLocalMedicineId()).isEqualTo(local.getId());
    }

    // ── 5. Missing/invalid linked medicine — graceful fallback, not a 500 ───

    @Test
    @DisplayName("LINKED but the catalogue target has since been deleted: enrichment and billing both "
            + "fall back to local-only behaviour instead of throwing")
    void linkedButTargetMedicineGoneFallsBackToLocalOnlyBehaviour() {
        Medicine catalogue = catalogueMedicine("Doxycycline 100 " + unique(), new BigDecimal("12"));
        PharmacyMedicine local = localMedicine("Doxycycline", new BigDecimal("12"));
        Inventory batch = localBatch(local.getId(), "DOX-1");
        pharmacyMedicineService.confirmLink(local.getId(), catalogue.getId());
        flushAndClear();

        // The catalogue medicine disappears (deleted from the catalogue) — the DB relation is
        // ON DELETE SET NULL (see schema.prisma PharmacyMedicine.linkedMedicine), so the local
        // identity is left LINKED with a now-null linkedMedicineId: a real, reachable "dangling
        // link" state, not a synthetic one.
        medicineRepository.deleteById(catalogue.getId());
        flushAndClear();

        PharmacyMedicine reloadedLocal = pharmacyMedicineRepository.findById(local.getId()).orElseThrow();
        assertThat(reloadedLocal.getMatchStatus()).as("deleting the target does not itself change matchStatus")
                .isEqualTo(MedicineMatchStatus.LINKED);
        assertThat(reloadedLocal.getLinkedMedicineId()).as("ON DELETE SET NULL").isNull();

        InventoryResponse resp = inventoryService.getById(batch.getId());
        assertThat(resp.medicine().id()).as("falls back to the local placeholder, not a 404/NPE")
                .isEqualTo(local.getId());
        assertThat(resp.medicine().allowLooseSale()).isFalse();
        assertThat(resp.medicine().unitsPerPack()).isNull();

        InvoiceResponse invoice = bill(batch.getId(), 1, "PACK");
        assertThat(invoice.items().get(0).medicineName()).isEqualTo("Doxycycline");
    }
}
