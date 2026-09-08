package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
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
import com.checkup.pharmacy.modules.medicine.MedicineService;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineService;
import com.checkup.pharmacy.modules.medicine.dto.LocalMedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.MedicineResponse;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest;
import com.checkup.pharmacy.modules.purchase.dto.GrnResponse;
import com.checkup.pharmacy.modules.reports.ReportsService;
import com.checkup.pharmacy.modules.reports.dto.ExpiryItemResponse;
import com.checkup.pharmacy.modules.reports.dto.Gstr3bResponse;
import com.checkup.pharmacy.modules.reports.dto.MarginReportResponse;
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
    @Autowired private ReportsService reportsService;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private MedicineService medicineService;
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

    /** A line naming a real global catalogue medicineId. */
    private GrnItemRequest matchedLine(String medicineId, String name, String batchNumber, int receivedQty) {
        return new GrnItemRequest(medicineId, null, name, null, null, null, null, null,
                null, null, batchNumber, Instant.now().plus(365, ChronoUnit.DAYS), 0, receivedQty, 0,
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

    @Test
    @DisplayName("a GRN mixing a matched catalogue line and an unmatched local line completes both correctly")
    void mixedMatchedAndUnmatchedGrnCompletesBoth() {
        Medicine catalogue = medicineRepository.save(Medicine.create("Ibuprofen 400 " + unique(), new BigDecimal("12")));
        String localName = "PCM Local " + unique();
        String grnId = createDraftGrn(
                matchedLine(catalogue.getId(), catalogue.getName(), "CAT-1", 40),
                unmatchedLine(localName, "LOC-1", 25));

        GrnResponse response = purchasesService.confirmGrn(grnId);
        flushAndClear();

        assertThat(response.items()).hasSize(2);
        GrnResponse.Item matchedItem = response.items().stream()
                .filter(i -> catalogue.getId().equals(i.medicineId())).findFirst().orElseThrow();
        assertThat(matchedItem.localMedicineId()).as("a matched line carries no localMedicineId").isNull();

        GrnResponse.Item localItem = response.items().stream()
                .filter(i -> i.medicineId() == null).findFirst().orElseThrow();
        assertThat(localItem.localMedicineId()).as("the unmatched line carries a localMedicineId").isNotNull();

        Inventory catalogueBatch = inventoryRepository
                .findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, catalogue.getId(), "CAT-1").orElseThrow();
        assertThat(catalogueBatch.getQuantity()).isEqualTo(40);

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, localName).orElseThrow();
        Inventory localBatch = inventoryRepository
                .findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-1").orElseThrow();
        assertThat(localBatch.getQuantity()).isEqualTo(25);
    }

    @Test
    @DisplayName("a GRN line naming an unknown global medicineId is rejected")
    void unknownGlobalMedicineIdIsRejected() {
        GrnItemRequest bad = matchedLine("not-a-real-medicine-id", "Ghost Catalogue Medicine", "CAT-X", 10);

        assertThatThrownBy(() -> createDraftGrn(bad))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("a new local medicine with a non-standard GST rate is rejected, not silently accepted")
    void nonStandardGstRateOnNewLocalMedicineIsRejected() {
        GrnItemRequest badRate = new GrnItemRequest(null, null, "Odd Rate Medicine " + unique(), null, null, null,
                null, null, null, null, "LOC-BAD-GST", Instant.now().plus(365, ChronoUnit.DAYS), 0, 10, 0,
                null, null, new BigDecimal("10.00"), new BigDecimal("20.00"), BigDecimal.ZERO, new BigDecimal("9"));

        assertThatThrownBy(() -> createDraftGrn(badRate))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("gstRate");
    }

    @Test
    @DisplayName("\"Save as Local Medicine\" also rejects a non-standard GST rate")
    void nonStandardGstRateOnDirectLocalCreateIsRejected() {
        var req = new com.checkup.pharmacy.modules.medicine.dto.CreateLocalMedicineRequest(
                "Odd Rate Direct " + unique(), null, null, null, null, null, null, new BigDecimal("9"), null);
        assertThatThrownBy(() -> pharmacyMedicineService.create(req))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("gstRate");
    }

    @Test
    @DisplayName("unlinking reverses a wrong link without touching the GRN/Inventory rows already written")
    void unlinkReversesLinkAdditively() {
        String name = "PCM Local " + unique();
        String grnId = createDraftGrn(unmatchedLine(name, "LOC-1", 50));
        purchasesService.confirmGrn(grnId);
        flushAndClear();

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, name).orElseThrow();
        Medicine wrongCatalogueMatch = medicineRepository.save(Medicine.create("Wrong Match " + unique(), new BigDecimal("12")));
        flushAndClear();

        pharmacyMedicineService.confirmLink(local.getId(), wrongCatalogueMatch.getId());
        flushAndClear();
        pharmacyMedicineService.unlink(local.getId());
        flushAndClear();

        PharmacyMedicine reloaded = pharmacyMedicineRepository.findById(local.getId()).orElseThrow();
        assertThat(reloaded.getLinkedMedicineId()).isNull();
        assertThat(reloaded.getMatchStatus())
                .as("unlink lands on KEPT_LOCAL so the background matcher can't silently redo the same wrong link")
                .isEqualTo(MedicineMatchStatus.KEPT_LOCAL);

        Inventory batch = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-1").orElseThrow();
        assertThat(batch.getLocalMedicineId()).isEqualTo(local.getId());
    }

    @Test
    @DisplayName("unlinking a medicine that isn't currently linked is rejected")
    void unlinkingAnUnlinkedMedicineIsRejected() {
        PharmacyMedicine local = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId,
                "Never Linked " + unique(), null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();

        assertThatThrownBy(() -> pharmacyMedicineService.unlink(local.getId()))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("the full local-medicine directory lists every status, flags catalogue-name ambiguity, and names the linked medicine")
    void listAllShowsEveryStatusWithAmbiguityAndLinkedName() {
        String kept = "Kept Local " + unique();
        PharmacyMedicine keptEntity = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, kept,
                null, null, null, null, null, null, new BigDecimal("12"), null));
        keptEntity.keepLocal();
        pharmacyMedicineRepository.save(keptEntity);

        String linkedName = "Linked Local " + unique();
        Medicine target = medicineRepository.save(Medicine.create("Target Catalogue " + unique(), new BigDecimal("12")));
        PharmacyMedicine linked = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, linkedName,
                null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();
        linked = pharmacyMedicineRepository.findById(linked.getId()).orElseThrow();
        linked.linkTo(target.getId());
        pharmacyMedicineRepository.save(linked);

        String dupName = "Ambiguous Dup " + unique();
        medicineRepository.save(Medicine.create(dupName, new BigDecimal("12")));
        medicineRepository.save(Medicine.create(dupName, new BigDecimal("12")));
        pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, dupName,
                null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();

        List<LocalMedicineResponse> all = pharmacyMedicineService.listAll();

        LocalMedicineResponse keptRow = all.stream().filter(r -> r.name().equals(kept)).findFirst().orElseThrow();
        assertThat(keptRow.matchStatus()).isEqualTo("KEPT_LOCAL");
        assertThat(keptRow.ambiguous()).isFalse();

        LocalMedicineResponse linkedRow = all.stream().filter(r -> r.name().equals(linkedName)).findFirst().orElseThrow();
        assertThat(linkedRow.matchStatus()).isEqualTo("LINKED");
        assertThat(linkedRow.linkedMedicineId()).isEqualTo(target.getId());
        assertThat(linkedRow.linkedMedicineName()).isEqualTo(target.getName());

        LocalMedicineResponse ambiguousRow = all.stream().filter(r -> r.name().equals(dupName)).findFirst().orElseThrow();
        assertThat(ambiguousRow.ambiguous())
                .as("two catalogue entries tied on the exact same name must be flagged distinctly, not just 'similar'")
                .isTrue();
    }

    @Test
    @DisplayName("billing search only surfaces a local medicine when includeLocal is requested, and never a LINKED one")
    void billingSearchIncludeLocalMergesUnlinkedLocalMedicinesOnly() {
        String localName = "IncludeLocalSearch " + unique();
        PharmacyMedicine local = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, localName,
                null, null, null, null, null, null, new BigDecimal("12"), null));

        String linkedName = "IncludeLocalLinked " + unique();
        Medicine target = medicineRepository.save(Medicine.create("Target For Linked " + unique(), new BigDecimal("12")));
        PharmacyMedicine linked = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, linkedName,
                null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();
        linked = pharmacyMedicineRepository.findById(linked.getId()).orElseThrow();
        linked.linkTo(target.getId());
        pharmacyMedicineRepository.save(linked);
        flushAndClear();

        List<MedicineResponse> withoutLocal = medicineService.quickSearch(localName, 8, false);
        assertThat(withoutLocal).as("default search stays catalogue-only").isEmpty();

        List<MedicineResponse> withLocal = medicineService.quickSearch(localName, 8, true);
        assertThat(withLocal).anySatisfy(r -> {
            assertThat(r.id()).isEqualTo(local.getId());
            assertThat(r.isLocal()).isTrue();
        });

        List<MedicineResponse> linkedSearch = medicineService.quickSearch(linkedName, 8, true);
        assertThat(linkedSearch)
                .as("a LINKED local medicine already has a usable global identity — must not be surfaced as local")
                .noneMatch(MedicineResponse::isLocal);
    }

    /** A line with a custom expiry date, bypassing the near-expiry block via allowNearExpiry. */
    private String createDraftGrnAllowingNearExpiry(GrnItemRequest item) {
        var request = new CreateGrnRequest(supplierId, null, "INV-" + unique(), Instant.now(),
                null, List.of(item), true, null);
        String id = purchasesService.createGrn(request).id();
        flushAndClear();
        return id;
    }

    private GrnItemRequest unmatchedLineExpiring(String name, String batchNumber, Instant expiryDate) {
        return new GrnItemRequest(null, null, name, "Local Pharma", null, "500mg", "TABLET", "STRIP",
                "3004", null, batchNumber, expiryDate, 0, 10, 0,
                null, null, new BigDecimal("10.00"), new BigDecimal("20.00"), BigDecimal.ZERO, new BigDecimal("12"));
    }

    @Test
    @DisplayName("a local medicine's batch nearing expiry shows its real name in the Expiry Alerts report, not a blank one")
    void localMedicineBatchNearingExpiryHasARealNameInExpiryAlerts() {
        String name = "PCM Local Expiring " + unique();
        Instant nearExpiry = Instant.now().plus(10, ChronoUnit.DAYS);
        String grnId = createDraftGrnAllowingNearExpiry(unmatchedLineExpiring(name, "LOC-EXP", nearExpiry));
        purchasesService.confirmGrn(grnId);
        flushAndClear();

        List<ExpiryItemResponse> alerts = reportsService.expiryReport(90, 500);
        assertThat(alerts)
                .as("the local medicine's own name must be shown, not a blank/null medicine ref")
                .anySatisfy(a -> assertThat(a.medicine().name()).isEqualTo(name));
    }

    @Test
    @DisplayName("a local medicine's sale shows its real name in the Margin report's top contributors, not a blank one")
    void localMedicineSaleHasARealNameInMarginReport() {
        String name = "PCM Local Margin " + unique();
        String grnId = createDraftGrn(unmatchedLine(name, "LOC-MARGIN", 50));
        purchasesService.confirmGrn(grnId);
        flushAndClear();

        PharmacyMedicine local = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, name).orElseThrow();
        Inventory batch = inventoryRepository.findByPharmacyIdAndLocalMedicineIdAndBatchNumber(pharmacyId, local.getId(), "LOC-MARGIN").orElseThrow();
        String customerId = customerRepository.save(Customer.create(pharmacyId, "Walk-in")).getId();
        flushAndClear();

        billingService.createInvoice(new CreateInvoiceRequest(customerId, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batch.getId(), 2, null, BigDecimal.ZERO, null))));
        flushAndClear();

        MarginReportResponse report = reportsService.marginReport(
                Instant.now().minus(1, ChronoUnit.HOURS), Instant.now().plus(1, ChronoUnit.HOURS), 50);
        assertThat(report.topContributors())
                .as("the local medicine's own name must be shown, not a blank/null medicine ref")
                .anySatisfy(item -> {
                    assertThat(item.medicine()).isNotNull();
                    assertThat(item.medicine().name()).isEqualTo(name);
                    assertThat(item.medicine().id()).isEqualTo(local.getId());
                });
    }

    @Test
    @DisplayName("an unwritten-off expired local medicine batch contributes to the GSTR-3B expired-stock/ITC-reversal exposure")
    void expiredLocalMedicineBatchCountsTowardGstr3bExpiredStock() {
        String name = "PCM Local Expired " + unique();
        Instant pastExpiry = Instant.now().minus(5, ChronoUnit.DAYS);
        String grnId = createDraftGrnAllowingNearExpiry(unmatchedLineExpiring(name, "LOC-EXPIRED", pastExpiry));
        purchasesService.confirmGrn(grnId);
        flushAndClear();

        Gstr3bResponse response = reportsService.gstr3b(Instant.now().minus(400, ChronoUnit.DAYS), Instant.now());
        assertThat(response.dataQuality().expiredStock().batches())
                .as("an expired, never-written-off local medicine batch must not be silently excluded "
                        + "from the ITC-reversal exposure just because it has no global medicineId")
                .isGreaterThanOrEqualTo(1);
        assertThat(response.dataQuality().expiredStock().embeddedItc())
                .as("its GST rate is on the PharmacyMedicine row itself, so the estimate must still price it")
                .isGreaterThan(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("the scheduled backstop only retries a PENDING local medicine once it's actually stale, not a fresh one")
    void retryStaleForPharmacyOnlyTouchesRowsOlderThanTheBackstopAge() {
        String freshName = "Fresh Pending " + unique();
        PharmacyMedicine fresh = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, freshName,
                null, null, null, null, null, null, new BigDecimal("12"), null));

        String staleName = "Stale Pending " + unique();
        Medicine catalogue = medicineRepository.save(Medicine.create(staleName, new BigDecimal("12")));
        PharmacyMedicine stale = pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, staleName,
                null, null, null, null, null, null, new BigDecimal("12"), null));
        flushAndClear();

        // GrnMedicineMatchService.BACKSTOP_AGE is 5 minutes — backdate only this row past it,
        // exactly the "matcher listener missed it" scenario the sweep exists to recover from.
        entityManager.createNativeQuery("UPDATE pharmacy_medicines SET \"createdAt\" = :t WHERE id = :id")
                .setParameter("t", Instant.now().minus(10, ChronoUnit.MINUTES))
                .setParameter("id", stale.getId())
                .executeUpdate();
        entityManager.clear();

        int processed = matchService.retryStaleForPharmacy(pharmacyId);
        flushAndClear();

        assertThat(processed).as("only the backdated row is stale enough for the backstop").isEqualTo(1);

        PharmacyMedicine freshReloaded = pharmacyMedicineRepository.findById(fresh.getId()).orElseThrow();
        assertThat(freshReloaded.getMatchStatus())
                .as("a row created moments ago must be left alone — the async listener, not the backstop, owns it")
                .isEqualTo(MedicineMatchStatus.PENDING);

        PharmacyMedicine staleReloaded = pharmacyMedicineRepository.findById(stale.getId()).orElseThrow();
        assertThat(staleReloaded.getMatchStatus())
                .as("the stale row, once swept, resolves via the same exact-name matcher as the async path")
                .isEqualTo(MedicineMatchStatus.LINKED);
        assertThat(staleReloaded.getLinkedMedicineId()).isEqualTo(catalogue.getId());
    }
}
