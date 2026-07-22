package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.dto.CreatePrescriptionRequest;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionItemRequest;
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
 * Prescription lifecycle, including the point where it meets billing.
 *
 * <p>The dispensing tests are the reason this is an integration test rather than a
 * unit one: "the patient came back for the rest of their prescription" is a statement
 * about two invoices, a prescription, and its items all persisting between calls.
 */
@Transactional
class PrescriptionIT extends AbstractPostgresIT {

    @Autowired private PrescriptionService prescriptionService;
    @Autowired private PrescriptionItemRepository prescriptionItemRepository;
    @Autowired private PrescriptionRepository prescriptionRepository;
    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String amoxicillinId;
    private String paracetamolId;
    private String amoxBatchId;
    private String paraBatchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();

        amoxicillinId = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12"))).getId();
        paracetamolId = medicineRepository.save(Medicine.create("Paracetamol 500", new BigDecimal("12"))).getId();
        amoxBatchId = inventoryRepository.save(batchOf(amoxicillinId, "AMOX-1")).getId();
        paraBatchId = inventoryRepository.save(batchOf(paracetamolId, "PARA-1")).getId();

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

    private Inventory batchOf(String medicineId, String batchNumber) {
        return Inventory.create(pharmacyId, medicineId, batchNumber,
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
    }

    /** A prescription for two medicines, 10 of each. */
    private String createTwoItemPrescription() {
        var request = new CreatePrescriptionRequest(null, "Dr Rao", "REG-1", null, "A Patient",
                40, null, null, Instant.now(), Instant.now().plus(30, ChronoUnit.DAYS), null,
                List.of(
                        new PrescriptionItemRequest("Amoxicillin 250", amoxicillinId, null, 10, null, null, null),
                        new PrescriptionItemRequest("Paracetamol 500", paracetamolId, null, 10, null, null, null)),
                null);
        String id = prescriptionService.create(request).id();
        flushAndClear();
        return id;
    }

    private CreateInvoiceRequest saleAgainst(String prescriptionId, String inventoryId, int quantity) {
        return new CreateInvoiceRequest(null, null, null, prescriptionId, null, null, null, null, null,
                null, null, null, null,
                List.of(new InvoiceItemRequest(inventoryId, quantity, BigDecimal.ZERO)));
    }

    private PrescriptionStatus statusOf(String id) {
        return prescriptionRepository.findById(id).orElseThrow().getStatus();
    }

    @Test
    @DisplayName("a new prescription starts ACTIVE with nothing dispensed")
    void newPrescriptionIsActive() {
        String id = createTwoItemPrescription();

        assertThat(statusOf(id)).isEqualTo(PrescriptionStatus.ACTIVE);
        assertThat(prescriptionItemRepository.findByPrescriptionId(id))
                .hasSize(2)
                .allSatisfy(item -> assertThat(item.getDispensedQty()).isZero());
    }

    /**
     * The case that matters clinically: a patient collects part of their prescription
     * and comes back for the rest.
     *
     * <p>Billing marked the whole prescription DISPENSED on the first sale, so the
     * return visit was refused with "Prescription is DISPENSED and cannot be used for
     * billing" — the patient could not collect medicine a doctor had prescribed. The
     * schema always intended otherwise: PrescriptionItem carries a dispensedQty column
     * and PrescriptionStatus has a PARTIAL member, and BillingService already accepts
     * PARTIAL as billable. Neither was ever written to.
     */
    @Test
    @DisplayName("collecting part of a prescription leaves it PARTIAL, not closed")
    void partialCollectionLeavesPrescriptionOpen() {
        String rxId = createTwoItemPrescription();

        // Visit one: the patient takes only the amoxicillin.
        billingService.createInvoice(saleAgainst(rxId, amoxBatchId, 10));
        flushAndClear();

        assertThat(statusOf(rxId))
                .as("one of two prescribed medicines collected — the prescription is not finished")
                .isEqualTo(PrescriptionStatus.PARTIAL);

        var items = prescriptionItemRepository.findByPrescriptionId(rxId);
        assertThat(items).filteredOn(i -> amoxicillinId.equals(i.getMedicineId()))
                .singleElement()
                .satisfies(i -> assertThat(i.getDispensedQty()).isEqualTo(10));
        assertThat(items).filteredOn(i -> paracetamolId.equals(i.getMedicineId()))
                .singleElement()
                .satisfies(i -> assertThat(i.getDispensedQty()).isZero());
    }

    @Test
    @DisplayName("the patient can return for the remainder of a partly-collected prescription")
    void patientCanReturnForTheRest() {
        String rxId = createTwoItemPrescription();

        billingService.createInvoice(saleAgainst(rxId, amoxBatchId, 10));
        flushAndClear();

        // Visit two: this threw UnprocessableEntityException before the fix.
        billingService.createInvoice(saleAgainst(rxId, paraBatchId, 10));
        flushAndClear();

        assertThat(statusOf(rxId))
                .as("everything prescribed has now been collected")
                .isEqualTo(PrescriptionStatus.DISPENSED);
    }

    @Test
    @DisplayName("collecting less than the prescribed quantity of a medicine keeps it open")
    void shortQuantityKeepsPrescriptionOpen() {
        String rxId = createTwoItemPrescription();

        // 4 of the 10 amoxicillin prescribed, and no paracetamol at all.
        billingService.createInvoice(saleAgainst(rxId, amoxBatchId, 4));
        flushAndClear();

        assertThat(statusOf(rxId)).isEqualTo(PrescriptionStatus.PARTIAL);
        assertThat(prescriptionItemRepository.findByPrescriptionId(rxId))
                .filteredOn(i -> amoxicillinId.equals(i.getMedicineId()))
                .singleElement()
                .satisfies(i -> assertThat(i.getDispensedQty()).isEqualTo(4));
    }

    @Test
    @DisplayName("collecting everything at once closes the prescription")
    void fullCollectionClosesPrescription() {
        String rxId = createTwoItemPrescription();

        var bothItems = new CreateInvoiceRequest(null, null, null, rxId, null, null, null, null, null,
                null, null, null, null,
                List.of(new InvoiceItemRequest(amoxBatchId, 10, BigDecimal.ZERO),
                        new InvoiceItemRequest(paraBatchId, 10, BigDecimal.ZERO)));

        billingService.createInvoice(bothItems);
        flushAndClear();

        assertThat(statusOf(rxId)).isEqualTo(PrescriptionStatus.DISPENSED);
    }

    @Test
    @DisplayName("a fully dispensed prescription cannot be billed again")
    void dispensedPrescriptionCannotBeReused() {
        String rxId = createTwoItemPrescription();

        var bothItems = new CreateInvoiceRequest(null, null, null, rxId, null, null, null, null, null,
                null, null, null, null,
                List.of(new InvoiceItemRequest(amoxBatchId, 10, BigDecimal.ZERO),
                        new InvoiceItemRequest(paraBatchId, 10, BigDecimal.ZERO)));
        billingService.createInvoice(bothItems);
        flushAndClear();

        assertThatThrownBy(() -> billingService.createInvoice(saleAgainst(rxId, amoxBatchId, 1)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("cannot be used for billing");
    }

    @Test
    @DisplayName("a cancelled prescription cannot be billed, updated, or cancelled again")
    void cancelledPrescriptionIsTerminal() {
        String rxId = createTwoItemPrescription();
        prescriptionService.cancel(rxId);
        flushAndClear();

        assertThat(statusOf(rxId)).isEqualTo(PrescriptionStatus.CANCELLED);
        assertThatThrownBy(() -> prescriptionService.cancel(rxId))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("already cancelled");
        assertThatThrownBy(() -> billingService.createInvoice(saleAgainst(rxId, amoxBatchId, 1)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("another pharmacy's prescription is not visible")
    void cannotReadAnotherPharmacysPrescription() {
        String rxId = createTwoItemPrescription();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> prescriptionService.getById(rxId))
                .isInstanceOf(NotFoundException.class);
    }
}
