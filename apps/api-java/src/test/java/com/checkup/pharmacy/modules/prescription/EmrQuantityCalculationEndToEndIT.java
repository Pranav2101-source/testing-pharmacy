package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
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
                null, "Asha Verma", null, null, "Dr. Rao", prescriptionId, "CASH", "PAID", null, null, null,
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
}
