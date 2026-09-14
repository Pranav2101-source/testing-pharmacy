package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.dispensing.DispensingService;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlan;
import com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionStockResponse;
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
 * The full chain named in the feature spec, against a real Postgres and every real service —
 * no mocks — proving the pieces actually fit together, not just that each compiles in
 * isolation:
 *
 * <pre>
 * EMR prescription (dosage + duration, no quantity)
 *   -&gt; PrescriptionQuantityCalculator derives the quantity
 *   -&gt; medicine matching resolves the catalogue product
 *   -&gt; sellable stock = quantity - reservedQuantity
 *   -&gt; billing bills the exact calculated quantity as a loose sale
 *   -&gt; inventory is deducted once, by exactly that amount
 *   -&gt; the prescribed line and the prescription itself close out consistently
 * </pre>
 *
 * <p>Pack/loose SELECTION itself ({@code resolveSaleUnit}) lives in the web client, in
 * TypeScript — see {@code prescriptionToCart.test.ts} for that half. What belongs here is
 * everything the backend owns: that the calculated number is the one that gets billed, and
 * that billing it leaves every counter (dispensed, reserved, on-hand) agreeing with each other.
 */
@Transactional
class EmrQuantityCalculationEndToEndIT extends AbstractPostgresIT {

    @Autowired private EmrIntegrationService emrIntegrationService;
    @Autowired private PrescriptionService prescriptionService;
    @Autowired private DispensingService dispensingService;
    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PrescriptionRepository prescriptionRepository;
    @Autowired private PrescriptionItemRepository prescriptionItemRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String medicineId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();

        // A strip of 10 tablets, loose selling switched on — the exact setup
        // PrescriptionQuantityCalculator's "countable base unit" scope targets.
        Medicine medicine = Medicine.create("Azithromycin 500", new BigDecimal("12"));
        medicine.setPackaging(10, "TABLET");
        medicineRepository.save(medicine);
        medicineId = medicine.getId();

        PharmacyMedicineOverride override = PharmacyMedicineOverride.create(pharmacyId, medicineId);
        override.setAllowLooseSale(true);
        overrideRepository.save(override);

        entityManager.flush();
        entityManager.clear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static Instant future() {
        return Instant.now().plus(365, ChronoUnit.DAYS);
    }

    private String seedBatch(int packs, int reserved) {
        Inventory batch = Inventory.create(pharmacyId, medicineId, "BATCH-" + unique(), future(),
                packs, new BigDecimal("10.00"), new BigDecimal("20.00"), 5, 5);
        batch.reserve(reserved);
        inventoryRepository.save(batch);
        entityManager.flush();
        entityManager.clear();
        return batch.getId();
    }

    private EmrPrescriptionIngestRequest ingestRequestWith(String dosage, String duration, int quantity) {
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Azithromycin 500", null, null, null,
                quantity, dosage, duration, null);
        return new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1", null,
                "Asha Verma", 30, null, null, null, null, null, List.of(item));
    }

    @Test
    @DisplayName("EMR prescription with no quantity -> calculated -> matched -> sellable -> billed loose -> "
            + "deducted -> prescription closes, with every counter agreeing")
    void fullChainFromCalculatedQuantityToLooseSale() {
        batchId = seedBatch(5, 0); // 5 packs x 10 = 50 pieces, nothing reserved

        // 1) EMR sends a prescription with NO quantity, only dosage + duration.
        EmrPrescriptionSnapshot snapshot = emrIntegrationService.ingest(ingestRequestWith("1-0-1", "6 days", 0));
        String prescriptionId = snapshot.pharmacyPrescriptionId();

        // 2) The calculator derived 1-0-1 x 6 days = 12, and the matcher resolved the medicine —
        // both happened as part of the SAME ingest call, with no separate step for either.
        PrescriptionItem item = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(item.getMedicineId()).as("EXACT_NAME matched the catalogue medicine").isEqualTo(medicineId);
        assertThat(item.getQuantity()).as("1-0-1 x 6 days").isEqualTo(12);
        assertThat(item.isQuantityAutoCalculated()).isTrue();
        assertThat(item.getQuantityCalculationNote()).contains("1-0-1").contains("6 days").contains("12");
        assertThat(item.needsQuantityConfirmation())
                .as("a calculated quantity is a real quantity, not a placeholder needing a pharmacist")
                .isFalse();

        // 3) Sellable stock for the triage screen's stock-check step: nothing reserved, so all
        // 50 pieces (5 packs x 10) are available against the 12 this line needs.
        PrescriptionStockResponse stock = prescriptionService.stockCheck(prescriptionId);
        assertThat(stock.items()).singleElement().satisfies(s -> {
            assertThat(s.availableQty()).isEqualTo(50);
            assertThat(s.stockStatus()).isEqualTo("in_stock");
        });

        // 4) Bill EXACTLY the calculated quantity, as loose pieces (12 is not a whole multiple
        // of the 10-tablet pack) — simulating what the web client's resolveSaleUnit would have
        // decided; this backend call is what actually moves stock and closes the prescription.
        InvoiceResponse invoice = billingService.createInvoice(new CreateInvoiceRequest(
                null, "Asha Verma", null, null, "Dr. Rao", prescriptionId, "CASH", "PAID", null, null, null, null,
                null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 12, null, BigDecimal.ZERO, null, "LOOSE", null))));
        entityManager.flush();
        entityManager.clear();

        assertThat(invoice.items()).singleElement().satisfies(line -> {
            assertThat(line.saleUnit()).isEqualTo("LOOSE");
            assertThat(line.quantity()).isEqualTo(12);
        });

        // 5) Inventory deducted by exactly 12 pieces, once — one pack broken (10 -> 9 packs
        // left as whole units) leaving 8 loose (10 - 2 cut from it, the other 10 sold whole
        // from the broken pack)... concretely: 50 pieces on hand, 12 sold, 38 must remain,
        // split across packs (whole tens) and a loose remainder.
        Inventory batch = inventoryRepository.findById(batchId).orElseThrow();
        int remainingPieces = batch.getQuantity() * 10 + batch.getLooseUnits();
        assertThat(remainingPieces).as("50 on hand - 12 sold, no more and no less").isEqualTo(38);

        // 6) The prescribed line and the prescription itself agree with what was actually sold —
        // no over-dispensing (12 requested, 12 recorded) and no double deduction.
        PrescriptionItem afterSale = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(afterSale.getDispensedQty()).isEqualTo(12);
        assertThat(afterSale.isFullyDispensed()).isTrue();
        Prescription prescription = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId).orElseThrow();
        assertThat(prescription.getStatus().name()).isEqualTo("DISPENSED");
    }

    @Test
    @DisplayName("reserved stock is never sellable: a fully-reserved batch reports out_of_stock for a "
            + "calculated quantity exactly as it would for a clinic-stated one")
    void reservedStockIsExcludedFromWhatACalculatedQuantityCanDrawOn() {
        batchId = seedBatch(2, 20); // 2 packs x 10 = 20 pieces, ALL of it already reserved elsewhere

        EmrPrescriptionSnapshot snapshot = emrIntegrationService.ingest(ingestRequestWith("1-1-1", "6 days", 0));
        String prescriptionId = snapshot.pharmacyPrescriptionId();

        PrescriptionItem item = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        // The calculation itself does not know or care about stock — 1-1-1 x 6 days = 18 either way.
        assertThat(item.getQuantity()).isEqualTo(18);
        assertThat(item.isQuantityAutoCalculated()).isTrue();

        PrescriptionStockResponse stock = prescriptionService.stockCheck(prescriptionId);
        assertThat(stock.items()).singleElement().satisfies(s -> {
            assertThat(s.availableQty()).as("quantity - reservedQuantity, floored at zero").isEqualTo(0);
            assertThat(s.stockStatus()).isEqualTo("out_of_stock");
        });
    }

    @Test
    @DisplayName("stockCheck converts packs to pieces with the PHARMACY's pack size, not just the "
            + "catalogue's — and reports the same shelf the dispensing engine sees")
    void stockCheckHonoursThePharmacyPackSizeOverride() {
        // The Melgain/Pantoprazole shape: the shared catalogue never classified this medicine
        // (unitsPerPack NULL — only a platform admin can set it), so the pharmacy classified it
        // for itself through an override. stockCheck used to read Medicine.unitsPerPack straight
        // and so treated every sealed pack as ONE piece, reporting 40 for a shelf the billing
        // cart reported as 400. Both numbers were shown to the same pharmacist, on two screens,
        // for the same medicine.
        Medicine lotion = Medicine.create("Melgain Solution", new BigDecimal("12"));
        lotion.setPackaging(null, null);                    // catalogue: unclassified
        lotion.setClassification(null, "Bottle");           // ...but it does record the packaging word
        medicineRepository.save(lotion);

        PharmacyMedicineOverride ov = PharmacyMedicineOverride.create(pharmacyId, lotion.getId());
        ov.applyLoosePos(true, 10);                    // the pharmacy's own pack size
        overrideRepository.save(ov);

        Inventory batch = Inventory.create(pharmacyId, lotion.getId(), "MEL-" + unique(), future(),
                40, new BigDecimal("250.00"), new BigDecimal("594.00"), 5, 5);
        batch.setLooseUnits(4);
        inventoryRepository.save(batch);
        entityManager.flush();
        entityManager.clear();

        var item = new EmrPrescriptionIngestRequest.Item("item-mel", "Melgain Solution", null, null, null,
                40, "1-0-1", "4 days", null);
        EmrPrescriptionSnapshot snapshot = emrIntegrationService.ingest(new EmrPrescriptionIngestRequest(
                "tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1", null,
                "Rajath", 35, null, null, null, null, null, List.of(item)));

        PrescriptionStockResponse stock = prescriptionService.stockCheck(snapshot.pharmacyPrescriptionId());
        assertThat(stock.items()).singleElement().satisfies(s -> {
            assertThat(s.availableQty())
                    .as("40 sealed packs x the pharmacy's 10 per pack, plus 4 already-open pieces")
                    .isEqualTo(404);
            assertThat(s.stockStatus()).isEqualTo("in_stock");
            // Carried so the triage screen can NAME the number instead of printing it bare.
            assertThat(s.unit()).isEqualTo("Bottle");
            // BaseUnits.resolve returns null — not "EACH" — for a medicine with neither a
            // stored base unit nor a form. Null IS the unclassified signal on the wire; the
            // web's saleUnitModel maps it to EACH at the point of display, so the screen still
            // reads "units" rather than inventing tablet vocabulary.
            assertThat(s.baseUnit()).as("unclassified stays unclassified on the wire").isNull();
        });

        // The engine — which always resolved the override — must agree with what the triage
        // screen now shows. Disagreement between these two was the whole defect.
        DispensingPlan plan = dispensingService.plan(List.of(
                new com.checkup.pharmacy.modules.dispensing.dto.DispensingPlanRequest.Line(
                        lotion.getId(), null, 40, null)));
        assertThat(plan.lines()).singleElement().satisfies(line -> {
            assertThat(line.allocations()).isNotEmpty();
            assertThat(line.allocations().get(0).unitsPerPack())
                    .as("the same override the stock check now uses").isEqualTo(10);
            assertThat(line.allocations().get(0).unit())
                    .as("the packaging word the cart needs so a bottle is not labelled a strip")
                    .isEqualTo("Bottle");
        });
    }

    @Test
    @DisplayName("a liquid medicine's calculated-quantity refusal does not block ingest, matching, or the "
            + "rest of a prescription — it only leaves that one line for a pharmacist")
    void liquidMedicineFallsBackToManualConfirmationWithoutBlockingIngest() {
        Medicine syrup = Medicine.create("Cough Syrup 100ml", new BigDecimal("12"));
        syrup.setPackaging(null, "ML");
        medicineRepository.save(syrup);
        entityManager.flush();
        entityManager.clear();

        var liquidItem = new EmrPrescriptionIngestRequest.Item("item-1", "Cough Syrup 100ml", null, null, null,
                0, "10ml-0-10ml", "6 days", null);
        var tabletItem = new EmrPrescriptionIngestRequest.Item("item-2", "Azithromycin 500", null, null, null,
                0, "1-0-1", "6 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1",
                null, "Asha Verma", 30, null, null, null, null, null, List.of(liquidItem, tabletItem));

        EmrPrescriptionSnapshot snapshot = emrIntegrationService.ingest(request);
        String prescriptionId = snapshot.pharmacyPrescriptionId();

        List<PrescriptionItem> items = prescriptionItemRepository.findByPrescriptionId(prescriptionId);
        PrescriptionItem liquid = items.stream().filter(i -> i.getMedicineName().contains("Syrup")).findFirst().orElseThrow();
        PrescriptionItem tablet = items.stream().filter(i -> i.getMedicineName().contains("Azithromycin")).findFirst().orElseThrow();

        assertThat(liquid.needsQuantityConfirmation()).as("ML is never auto-calculated").isTrue();
        assertThat(liquid.getQuantityCalculationNote()).containsIgnoringCase("millilitres");
        // The OTHER line on the same prescription still calculated normally — one line's
        // refusal does not contaminate the rest of the same ingest call.
        assertThat(tablet.getQuantity()).isEqualTo(12);
        assertThat(tablet.isQuantityAutoCalculated()).isTrue();
    }

    @Test
    @DisplayName("a clinic-STATED quantity for a measured medicine with no pack size is set aside for "
            + "confirmation, not billed as N sealed bottles")
    void clinicQuantityForAnUnclassifiedMeasuredMedicineIsDeferred() {
        Medicine unclassified = Medicine.create("Melgain Solution", new BigDecimal("12"));
        unclassified.setPackaging(null, "ML");
        medicineRepository.save(unclassified);

        Medicine classified = Medicine.create("Grilinctus Syrup 100ml", new BigDecimal("12"));
        classified.setPackaging(100, "ML");
        medicineRepository.save(classified);
        entityManager.flush();
        entityManager.clear();

        // Both lines carry the clinic's own computed volume (30 ml / 100 ml).
        var ambiguous = new EmrPrescriptionIngestRequest.Item("item-1", "Melgain Solution", null, null, null,
                30, "3ml-0-3ml", "5 days", null);
        var unambiguous = new EmrPrescriptionIngestRequest.Item("item-2", "Grilinctus Syrup 100ml", null, null, null,
                100, "5ml-5ml-5ml", "5 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1",
                null, "Asha Verma", 30, null, null, null, null, null, List.of(ambiguous, unambiguous));

        EmrPrescriptionSnapshot snapshot = emrIntegrationService.ingest(request);
        List<PrescriptionItem> items = prescriptionItemRepository.findByPrescriptionId(snapshot.pharmacyPrescriptionId());

        PrescriptionItem melgain = items.stream()
                .filter(i -> i.getMedicineName().contains("Melgain")).findFirst().orElseThrow();
        assertThat(melgain.getQuantity()).as("the ambiguous 30 is not trusted").isZero();
        assertThat(melgain.needsQuantityConfirmation()).isTrue();
        assertThat(melgain.getQuantityCalculationNote()).contains("30 ml").containsIgnoringCase("no pack size");

        PrescriptionItem grilinctus = items.stream()
                .filter(i -> i.getMedicineName().contains("Grilinctus")).findFirst().orElseThrow();
        assertThat(grilinctus.getQuantity()).as("100 ml against a 100 ml bottle is unambiguous").isEqualTo(100);
        assertThat(grilinctus.needsQuantityConfirmation()).isFalse();
    }

    @Test
    @DisplayName("a pharmacy pack-size override rounds a measured clinic volume up to whole sealed packs, "
            + "even when the shared catalogue never classified the medicine")
    void anOverridePackSizeRoundsAMeasuredClinicVolumeUp() {
        Medicine unclassified = Medicine.create("Cetaphil Lotion", new BigDecimal("12"));
        unclassified.setPackaging(null, "ML");
        medicineRepository.save(unclassified);
        PharmacyMedicineOverride override = PharmacyMedicineOverride.create(pharmacyId, unclassified.getId());
        override.applyLoosePos(false, 250);
        overrideRepository.save(override);
        entityManager.flush();
        entityManager.clear();

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Cetaphil Lotion", null, null, null,
                50, "twice daily", "5 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1",
                null, "Asha Verma", 30, null, null, null, null, null, List.of(item));

        EmrPrescriptionSnapshot snapshot = emrIntegrationService.ingest(request);
        PrescriptionItem saved = prescriptionItemRepository
                .findByPrescriptionId(snapshot.pharmacyPrescriptionId()).get(0);

        assertThat(saved.getRoundedPackCount()).as("ceil(50 / 250) — a sealed 250 ml pack can't be split").isEqualTo(1);
        assertThat(saved.getQuantity()).as("dispense target is one whole 250 ml pack").isEqualTo(250);
        assertThat(saved.getPrescribedVolumeClinical()).isEqualByComparingTo("50");
        assertThat(saved.needsQuantityConfirmation()).isFalse();
    }

    @Test
    @DisplayName("clinic 30 ml -> deferred -> pharmacist confirms 1 bottle: the dispensing plan and the bill "
            + "draw 1 bottle, NEVER the clinic's 30")
    void confirmedBottleCountIsWhatBillsNotTheClinicMillilitres() {
        // An unclassified measured medicine with real stock on the shelf.
        Medicine syrup = Medicine.create("Ambroxol Syrup", new BigDecimal("12"));
        syrup.setPackaging(null, "ML");
        medicineRepository.save(syrup);
        Inventory batch = Inventory.create(pharmacyId, syrup.getId(), "SYR-" + unique(), future(),
                8, new BigDecimal("40.00"), new BigDecimal("70.00"), 2, 2); // 8 sealed bottles
        inventoryRepository.save(batch);
        entityManager.flush();
        entityManager.clear();

        // 1) EMR sends the clinic's own computed volume: 30 ml.
        var line = new EmrPrescriptionIngestRequest.Item("item-1", "Ambroxol Syrup", null, null, null,
                30, "3ml-0-3ml", "5 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1",
                null, "Asha Verma", 30, null, null, null, null, null, List.of(line));
        String prescriptionId = emrIntegrationService.ingest(request).pharmacyPrescriptionId();

        PrescriptionItem deferred = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(deferred.needsQuantityConfirmation()).as("30 ml is held, not billed as 30 bottles").isTrue();
        String itemId = deferred.getId();

        // 2) Pharmacist settles it at 1 bottle.
        prescriptionService.confirmItemQuantity(prescriptionId, itemId, 1);
        entityManager.flush();
        entityManager.clear();
        assertThat(prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0).getQuantity())
                .as("the pharmacist's 1 stands — the clinic's 30 does not come back").isEqualTo(1);

        // 3) The dispensing plan is what ClinicPrescriptionTriage / prescriptionToCart turns into
        //    cart lines. Its allocation must be exactly 1 sealed bottle.
        DispensingPlan plan = dispensingService.planForPrescription(prescriptionId);
        assertThat(plan.lines()).singleElement().satisfies(pl -> {
            assertThat(pl.roundedUpToPieces()).as("no phantom round-up to the clinic's 30").isNull();
            assertThat(pl.allocations()).singleElement().satisfies(a -> {
                assertThat(a.saleUnit()).isEqualTo("PACK");
                assertThat(a.quantity()).as("1 sealed bottle billed, not 30").isEqualTo(1);
            });
        });

        // 4) Billing that plan deducts exactly one bottle.
        var invoice = billingService.createInvoice(new CreateInvoiceRequest(
                null, "Asha Verma", null, null, "Dr. Rao", prescriptionId, "CASH", "PAID", null, null, null, null,
                null, null, null, null, null,
                List.of(new InvoiceItemRequest(batch.getId(), 1, null, BigDecimal.ZERO, null, "PACK", null))));
        entityManager.flush();
        entityManager.clear();
        assertThat(invoice.items()).singleElement().satisfies(l -> {
            assertThat(l.saleUnit()).isEqualTo("PACK");
            assertThat(l.quantity()).isEqualTo(1);
        });
        assertThat(inventoryRepository.findById(batch.getId()).orElseThrow().getQuantity())
                .as("8 bottles on hand - 1 sold").isEqualTo(7);
    }

    @Test
    @DisplayName("105 ml liquid Rx against a 100 ml bottle -> 2 sealed bottles -> billed -> 2 packs deducted -> "
            + "prescription DISPENSED -> dispense callback queued (never 105 bottles, never stuck PARTIAL)")
    void measuredLiquidRoundsToWholeBottlesBillsAndClosesThePrescription() {
        // A classified 100 ml syrup, sold sealed only (no loose override).
        Medicine syrup = medicineRepository.save(Medicine.create("Benadryl Cough Syrup 100ml", new BigDecimal("12")));
        syrup.setPackaging(100, "ML");
        medicineRepository.save(syrup);
        Inventory batch = inventoryRepository.save(Inventory.create(pharmacyId, syrup.getId(), "BEN-" + unique(),
                future(), 5, new BigDecimal("40.00"), new BigDecimal("90.00"), 2, 2)); // 5 sealed 100 ml bottles
        entityManager.flush();
        entityManager.clear();

        // 1) EMR sends the clinic's own computed volume: 5 ml TDS x 7 days = 105 ml.
        var line = new EmrPrescriptionIngestRequest.Item("item-1", "Benadryl Cough Syrup 100ml", null, null, null,
                105, "5 ml three times a day", "7 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-liquid", "rx-" + unique(), null, "Dr. Rao", "MCI-9",
                null, "Asha Verma", 30, null, null, null, null, null, List.of(line));
        String prescriptionId = emrIntegrationService.ingest(request).pharmacyPrescriptionId();

        // 2) Ingest rounded 105 ml up to 2 sealed bottles and kept the clinical figure beside it.
        PrescriptionItem ingested = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(ingested.getMedicineId()).isEqualTo(syrup.getId());
        assertThat(ingested.getRoundedPackCount()).as("ceil(105 / 100)").isEqualTo(2);
        assertThat(ingested.getQuantity()).as("dispense target in mL — 2 sealed 100 ml bottles").isEqualTo(200);
        assertThat(ingested.getPrescribedVolumeClinical()).isEqualByComparingTo("105");
        assertThat(ingested.getClinicalUom()).isEqualTo("ML");
        assertThat(ingested.isMeasuredRoundedUp()).isTrue();
        assertThat(ingested.needsQuantityConfirmation()).as("ready to bill, not held").isFalse();

        // 3) The dispensing plan allocates exactly 2 sealed bottles.
        DispensingPlan plan = dispensingService.planForPrescription(prescriptionId);
        assertThat(plan.lines()).singleElement().satisfies(pl -> {
            assertThat(pl.fullyAllocated()).isTrue();
            assertThat(pl.allocations()).singleElement().satisfies(a -> {
                assertThat(a.saleUnit()).isEqualTo("PACK");
                assertThat(a.quantity()).as("2 bottles, never 105").isEqualTo(2);
            });
        });

        // 4) Bill those 2 bottles.
        InvoiceResponse invoice = billingService.createInvoice(new CreateInvoiceRequest(
                null, "Asha Verma", null, null, "Dr. Rao", prescriptionId, "CASH", "PAID", null, null, null, null,
                null, null, null, null, null,
                List.of(new InvoiceItemRequest(batch.getId(), 2, null, BigDecimal.ZERO, null, "PACK", null))));
        entityManager.flush();
        entityManager.clear();
        assertThat(invoice.items()).singleElement().satisfies(l -> {
            assertThat(l.saleUnit()).isEqualTo("PACK");
            assertThat(l.quantity()).as("2 bottles billed").isEqualTo(2);
        });

        // 5) Inventory dropped by exactly 2 whole packs — not 105, not by unitsPerPack.
        assertThat(inventoryRepository.findById(batch.getId()).orElseThrow().getQuantity())
                .as("5 bottles on hand - 2 sold").isEqualTo(3);

        // 6) The write-back is in base units (mL): 2 packs x 100 = 200 recorded against the
        //    prescribed 200 — so the line and the prescription both close, instead of the line
        //    recording "2" against "200" and the prescription being stuck PARTIAL forever.
        PrescriptionItem afterSale = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(afterSale.getDispensedQty()).isEqualTo(200);
        assertThat(afterSale.isFullyDispensed()).isTrue();

        Prescription prescription = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId).orElseThrow();
        assertThat(prescription.getStatus().name()).isEqualTo("DISPENSED");
        // 7) A clinic prescription -> the dispense callback is queued (delivered AFTER_COMMIT).
        assertThat(prescription.getDispenseNotifyStatus())
                .as("callback queued so the clinic chart flips to DISPENSED").isEqualTo("PENDING");
    }

    @Test
    @DisplayName("stockCheck's live pack-count projection divides the CLINIC's prescribed volume, not the "
            + "already-rounded dispense target — the two only ever looked the same because quantity is "
            + "an exact multiple of the pack size IT was rounded against, not necessarily today's")
    void stockCheckProjectsAgainstTheClinicalVolumeNotTheRoundedTarget() {
        Medicine syrup = medicineRepository.save(Medicine.create("Ascoril Syrup 100ml", new BigDecimal("12")));
        syrup.setPackaging(100, "ML");
        medicineRepository.save(syrup);
        entityManager.flush();
        entityManager.clear();

        // Clinic asks for 150 ml; at a 100 ml pack that rounds up to 2 sealed bottles (a 200 ml
        // dispense target) — the reported case: triage showed "200 ml ÷ 100 ml/bottle" next
        // to "Prescribed: 150 ml" one line up.
        var item = new EmrPrescriptionIngestRequest.Item("item-1", "Ascoril Syrup 100ml", null, null, null,
                150, "5ml-0-5ml", "15 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1",
                null, "Asha Verma", 30, null, null, null, null, null, List.of(item));
        String prescriptionId = emrIntegrationService.ingest(request).pharmacyPrescriptionId();

        PrescriptionItem ingested = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(ingested.getQuantity()).as("2 sealed 100 ml bottles").isEqualTo(200);
        assertThat(ingested.getPrescribedVolumeClinical()).isEqualByComparingTo("150");

        // The catalogue is corrected to a 60 ml bottle after ingest — before anything is
        // dispensed and before anyone has called re-resolve. Dividing the stale 200 ml target
        // by 60 (=4) would disagree with dividing the clinic's actual 150 ml ask by 60 (=3).
        syrup = medicineRepository.findById(syrup.getId()).orElseThrow();
        syrup.setPackaging(60, "ML");
        medicineRepository.save(syrup);
        entityManager.flush();
        entityManager.clear();

        PrescriptionStockResponse stock = prescriptionService.stockCheck(prescriptionId);
        assertThat(stock.items()).singleElement().satisfies(s -> {
            assertThat(s.effectivePackSize()).isEqualTo(60);
            assertThat(s.projectedPackCount())
                    .as("ceil(150 / 60), the clinic's own ask — NOT ceil(200 / 60)").isEqualTo(3);
        });
    }

    @Test
    @DisplayName("stockCheck reports no live pack-count projection for a line a pharmacist already settled "
            + "by hand — its quantity IS a confirmed pack count, not a volume to divide")
    void stockCheckSuppressesTheProjectionForAPharmacistSettledLine() {
        // Unclassified: resolveMeasuredEmrQuantity holds this line for the pharmacist instead
        // of resolving it, which is what lets confirmQuantity store a pack count as `quantity`.
        Medicine tonic = medicineRepository.save(Medicine.create("QA Held Tonic", new BigDecimal("12")));
        tonic.setPackaging(null, "ML");
        medicineRepository.save(tonic);
        entityManager.flush();
        entityManager.clear();

        var item = new EmrPrescriptionIngestRequest.Item("item-1", "QA Held Tonic", null, null, null,
                300, "10ml-0-10ml", "15 days", null);
        var request = new EmrPrescriptionIngestRequest("tenant-1", "rx-" + unique(), null, "Dr. Rao", "MCI-1",
                null, "Asha Verma", 40, null, null, null, null, null, List.of(item));
        String prescriptionId = emrIntegrationService.ingest(request).pharmacyPrescriptionId();
        String itemId = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0).getId();

        prescriptionService.confirmItemQuantity(prescriptionId, itemId, 3);
        entityManager.flush();
        entityManager.clear();

        // The catalogue gains a pack size afterwards — exactly the sequence that reproduced the
        // reported bug: "3 ml ÷ 50 ml/bottle → 1 bottle" beside a correctly confirmed
        // "3 bottles", because 3 (the confirmed PACK COUNT) got divided as though it were mL.
        PharmacyMedicineOverride override = PharmacyMedicineOverride.create(pharmacyId, tonic.getId());
        override.applyLoosePos(false, 50);
        overrideRepository.save(override);
        entityManager.flush();
        entityManager.clear();

        PrescriptionStockResponse stock = prescriptionService.stockCheck(prescriptionId);
        assertThat(stock.items()).singleElement().satisfies(s -> {
            assertThat(s.effectivePackSize()).as("nothing to project — quantity is a confirmed pack count").isNull();
            assertThat(s.projectedPackCount()).isNull();
            assertThat(s.packCountWarning()).isNull();
        });

        PrescriptionItem settled = prescriptionItemRepository.findByPrescriptionId(prescriptionId).get(0);
        assertThat(settled.getQuantity()).as("the pharmacist's 3 stands").isEqualTo(3);
        assertThat(settled.getRoundedPackCount()).isEqualTo(3);
    }
}
