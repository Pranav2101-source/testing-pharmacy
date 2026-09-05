package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.GrnMedicineMatchService;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineService;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
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
 * GRN Phase 1 — receiving a medicine not yet in the global catalog must never
 * block the GRN. Covers the escape hatch end to end: an unmatched line resolves
 * to a {@link PharmacyMedicine}, becomes real sellable stock, and the background
 * matcher (tested directly here, not through the AFTER_COMMIT event — a
 * {@code @Transactional} test never commits, so that listener would never fire)
 * links or defers it without ever touching the GRN/Inventory/InvoiceItem rows
 * already written.
 */
@Transactional
class GrnLocalMedicineIT extends AbstractPostgresIT {

    @Autowired private PurchasesService purchasesService;
    @Autowired private BillingService billingService;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private PharmacyMedicineRepository pharmacyMedicineRepository;
    @Autowired private PharmacyMedicineService pharmacyMedicineService;
    @Autowired private GrnMedicineMatchService matchService;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String supplierId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Acme Distributors")).getId();

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

    /** A line naming no medicineId/localMedicineId — must resolve-or-create a pharmacy-local medicine. */
    private GrnItemRequest unmatchedLine(String name, String batchNumber, int receivedQty) {
        return new GrnItemRequest(null, null, name, "Local Pharma", null, "500mg", "TABLET", "STRIP",
                "3004", null, batchNumber, Instant.now().plus(365, ChronoUnit.DAYS), 0, receivedQty, 0,
                null, null, new BigDecimal("10.00"), new BigDecimal("20.00"), BigDecimal.ZERO, new BigDecimal("12"));
    }

    private String createDraftGrn(GrnItemRequest... items) {
        var request = new CreateGrnRequest(supplierId, null, "INV-" + unique(), Instant.now(),
                null, List.of(items), false, null);
        String id = purchasesService.createGrn(request).id();
        flushAndClear();
        return id;
    }

    @Test
    @DisplayName("a GRN with an unrecognized medicine still completes and receives real stock")
    void unmatchedLineReceivesIntoLocalInventory() {
        String name = "PCM Local " + unique();
        String grnId = createDraftGrn(unmatchedLine(name, "LOC-1", 50));

        purchasesService.confirmGrn(grnId);
        flushAndClear();

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, name)
                .orElseThrow(() -> new AssertionError("expected a local medicine to have been created"));
        assertThat(local.getGstRate()).isEqualByComparingTo("12");
        assertThat(local.getHsnCode()).isEqualTo("3004");
        assertThat(local.getMatchStatus()).isEqualTo(MedicineMatchStatus.PENDING);

        Inventory batch = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-1")
                .orElseThrow(() -> new AssertionError("expected a batch received against the local medicine"));
        assertThat(batch.getMedicineId()).isNull();
        assertThat(batch.getQuantity()).isEqualTo(50);
    }

    @Test
    @DisplayName("repeat receipt of the same local medicine+batch merges, not duplicates")
    void repeatReceiptOfLocalMedicineMergesIntoSameBatch() {
        String name = "PCM Local " + unique();
        purchasesService.confirmGrn(createDraftGrn(unmatchedLine(name, "LOC-1", 50)));
        flushAndClear();
        purchasesService.confirmGrn(createDraftGrn(unmatchedLine(name, "LOC-1", 30)));
        flushAndClear();

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, name).orElseThrow();
        List<Inventory> batches = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(
                pharmacyId, local.getId(), "LOC-1").map(List::of).orElse(List.of());
        assertThat(batches).as("same local medicine and batch number is one stock line, not two").hasSize(1);
        assertThat(batches.get(0).getQuantity()).isEqualTo(80);
    }

    @Test
    @DisplayName("two lines naming the same new local product in one GRN share one local medicine")
    void sameLocalNameAcrossTwoLinesReusesOneLocalMedicine() {
        String name = "PCM Local " + unique();
        String grnId = createDraftGrn(unmatchedLine(name, "LOC-A", 10), unmatchedLine(name, "LOC-B", 20));

        purchasesService.confirmGrn(grnId);
        flushAndClear();

        long count = pharmacyMedicineRepository.findAll().stream()
                .filter(m -> m.getPharmacyId().equals(pharmacyId) && m.getName().equalsIgnoreCase(name))
                .count();
        assertThat(count).as("one local identity, not one per line").isEqualTo(1);
    }

    @Test
    @DisplayName("a GRN line naming an unknown localMedicineId is rejected")
    void unknownLocalMedicineIdIsRejected() {
        GrnItemRequest bad = new GrnItemRequest(null, "not-a-real-id", "Ghost Medicine", null, null, null, null,
                null, null, null, "LOC-X", Instant.now().plus(365, ChronoUnit.DAYS), 0, 10, 0,
                null, null, new BigDecimal("10.00"), new BigDecimal("20.00"), BigDecimal.ZERO, new BigDecimal("12"));

        assertThatThrownBy(() -> createDraftGrn(bad))
                .isInstanceOf(NotFoundException.class)
                .hasMessageContaining("local medicine");
    }

    @Test
    @DisplayName("a local medicine's batch is fully sellable — the invoice snapshot carries its name/HSN/GST")
    void localMedicineIsBillable() {
        String name = "PCM Local " + unique();
        String grnId = createDraftGrn(unmatchedLine(name, "LOC-1", 50));
        purchasesService.confirmGrn(grnId);
        flushAndClear();

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, name).orElseThrow();
        Inventory batch = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-1").orElseThrow();
        String customerId = customerRepository.save(Customer.create(pharmacyId, "Walk-in")).getId();
        flushAndClear();

        var item = new InvoiceItemRequest(batch.getId(), 2, null, BigDecimal.ZERO, null);
        InvoiceResponse invoice = billingService.createInvoice(new CreateInvoiceRequest(customerId, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, null, List.of(item)));
        flushAndClear();

        assertThat(invoice.items()).hasSize(1);
        var line = invoice.items().get(0);
        assertThat(line.medicineName()).isEqualTo(name);
        assertThat(line.hsnCode()).isEqualTo("3004");
        assertThat(line.gstRate()).isEqualByComparingTo("12");

        Inventory reloaded = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-1").orElseThrow();
        assertThat(reloaded.getQuantity()).isEqualTo(48);
    }

    @Test
    @DisplayName("background matcher: an exact catalogue name match auto-links deterministically")
    void backgroundMatcherAutoLinksOnExactName() {
        String sharedName = "Amoxicillin 250 " + unique();
        Medicine catalogue = medicineRepository.save(Medicine.create(sharedName, new BigDecimal("12")));
        PharmacyMedicine local = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, sharedName,
                null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();

        matchService.matchIds(pharmacyId, List.of(local.getId()));
        flushAndClear();

        PharmacyMedicine reloaded = pharmacyMedicineRepository.findById(local.getId()).orElseThrow();
        assertThat(reloaded.getMatchStatus()).isEqualTo(MedicineMatchStatus.LINKED);
        assertThat(reloaded.getLinkedMedicineId()).isEqualTo(catalogue.getId());
    }

    @Test
    @DisplayName("background matcher never auto-links a fuzzy-only candidate — it only suggests")
    void backgroundMatcherNeverAutoLinksFuzzyMatch() {
        String suffix = unique();
        medicineRepository.save(Medicine.create("Paracetamol 500mg Tablet " + suffix, new BigDecimal("12")));
        PharmacyMedicine local = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId,
                "PCM-500 " + suffix, null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();

        matchService.matchIds(pharmacyId, List.of(local.getId()));
        flushAndClear();

        PharmacyMedicine reloaded = pharmacyMedicineRepository.findById(local.getId()).orElseThrow();
        assertThat(reloaded.getLinkedMedicineId())
                .as("a plausible-but-not-exact name must never be auto-linked")
                .isNull();
        assertThat(reloaded.getMatchStatus()).isIn(MedicineMatchStatus.SUGGESTED, MedicineMatchStatus.KEPT_LOCAL);
    }

    @Test
    @DisplayName("confirming a link is additive — it never rewrites the GRN/Inventory rows already written")
    void confirmLinkNeverRewritesHistoricalRows() {
        String name = "PCM Local " + unique();
        String grnId = createDraftGrn(unmatchedLine(name, "LOC-1", 50));
        purchasesService.confirmGrn(grnId);
        flushAndClear();

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, name).orElseThrow();
        Medicine catalogue = medicineRepository.save(Medicine.create("Paracetamol 500mg", new BigDecimal("12")));
        flushAndClear();

        pharmacyMedicineService.confirmLink(local.getId(), catalogue.getId());
        flushAndClear();

        Inventory batch = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-1").orElseThrow();
        assertThat(batch.getMedicineId())
                .as("linking the identity must not repoint an already-received batch")
                .isNull();
        assertThat(batch.getLocalMedicineId()).isEqualTo(local.getId());

        PharmacyMedicine reloaded = pharmacyMedicineRepository.findById(local.getId()).orElseThrow();
        assertThat(reloaded.getLinkedMedicineId()).isEqualTo(catalogue.getId());
        assertThat(reloaded.getMatchStatus()).isEqualTo(MedicineMatchStatus.LINKED);
    }
}
