package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.dto.BulkImportRequest;
import com.checkup.pharmacy.modules.medicine.dto.CreateMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.UpdateMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.UpsertOverrideRequest;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The shared medicine catalog: platform-wide entity (no pharmacyId — verified
 * against {@link Medicine}), with per-pharmacy customization living entirely in
 * {@link PharmacyMedicineOverride} (whose id embeds pharmacyId, so it cannot
 * structurally leak). Role gating (PLATFORM_ADMIN for edit/deactivate/activate,
 * OWNER/MANAGER for classification) is enforced by {@code @PreAuthorize} on
 * {@link MedicineController} and verified there by inspection, not re-tested
 * here at the bare-service level.
 *
 * <p>Review found one real gap: {@code update()} had no duplicate name+manufacturer
 * check, unlike {@code create()}/{@code bulkImport()} — a rename could silently
 * collide with another active catalog entry. Fixed with
 * {@code existsActiveDuplicateExcludingId}; {@link #renamingToAnotherActiveMedicinesNameIsRejected}
 * pins it.
 */
@Transactional
class MedicineIT extends AbstractPostgresIT {

    @Autowired private MedicineService medicineService;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private InventoryRepository inventoryRepository;
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

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private CreateMedicineRequest createReq(String name, String manufacturer, BigDecimal gstRate) {
        return new CreateMedicineRequest(name, "Amoxicillin", manufacturer, null, null, null, null,
                gstRate, "Tablet", "250mg", "strip", "10");
    }

    private UpdateMedicineRequest updateReq(String name, String manufacturer, BigDecimal gstRate) {
        return new UpdateMedicineRequest(name, "Amoxicillin", manufacturer, null, null, null, null,
                gstRate, "Tablet", "250mg", "strip", "10");
    }

    @Test
    @DisplayName("a created medicine is retrievable and active by default")
    void createdMedicineIsActive() {
        var created = medicineService.create(createReq("Amoxil 250", "Cipla", new BigDecimal("12")));

        assertThat(created.isActive()).isTrue();
        assertThat(created.gstRate()).isEqualByComparingTo(new BigDecimal("12"));
    }

    @Test
    @DisplayName("the platform admin can set units-per-pack and base unit on a catalogue medicine")
    void catalogueTakesPackaging() {
        var req = new CreateMedicineRequest("Crocin 500 " + unique(), "Paracetamol", "GSK", null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "15 tablets", 15, "tablet");
        var created = medicineService.create(req);
        assertThat(created.unitsPerPack()).isEqualTo(15);
        assertThat(created.baseUnit()).isEqualTo("TABLET");   // normalised to upper-case

        var upd = new UpdateMedicineRequest(created.name(), "Paracetamol", "GSK", null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "10 tablets", 10, "TABLET");
        var updated = medicineService.update(created.id(), upd);
        assertThat(updated.unitsPerPack()).isEqualTo(10);
    }

    @Test
    @DisplayName("an unrecognised base unit is rejected")
    void badBaseUnitRejected() {
        var req = new CreateMedicineRequest("Bad Unit Med " + unique(), null, "Mfr", null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "10", 10, "PILLS");
        assertThatThrownBy(() -> medicineService.create(req))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("Base unit");
    }

    @Test
    @DisplayName("creating a medicine with an unsupported GST rate is rejected")
    void invalidGstRateRejectedOnCreate() {
        assertThatThrownBy(() -> medicineService.create(createReq("Bad Rate Med", "Cipla", new BigDecimal("9"))))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("two active medicines with the same name and manufacturer are rejected")
    void duplicateRejectedOnCreate() {
        medicineService.create(createReq("Dolo 650", "Micro Labs", new BigDecimal("12")));
        flushAndClear();

        assertThatThrownBy(() -> medicineService.create(createReq("Dolo 650", "Micro Labs", new BigDecimal("12"))))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("the same name is fine under a different manufacturer")
    void sameNameDifferentManufacturerAllowed() {
        medicineService.create(createReq("Paracetamol 500", "Micro Labs", new BigDecimal("12")));
        flushAndClear();

        var created = medicineService.create(createReq("Paracetamol 500", "Cipla", new BigDecimal("12")));
        assertThat(created.id()).isNotBlank();
    }

    @Test
    @DisplayName("renaming a medicine to collide with another active medicine's name+manufacturer is rejected")
    void renamingToAnotherActiveMedicinesNameIsRejected() {
        medicineService.create(createReq("Crocin 500", "GSK", new BigDecimal("12")));
        var target = medicineService.create(createReq("Something Else", "GSK", new BigDecimal("12")));
        flushAndClear();

        assertThatThrownBy(() -> medicineService.update(target.id(), updateReq("Crocin 500", "GSK", new BigDecimal("12"))))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("updating a medicine without changing its name+manufacturer is not treated as a self-collision")
    void updatingWithUnchangedNameDoesNotSelfCollide() {
        var created = medicineService.create(createReq("Azithral 500", "Alembic", new BigDecimal("12")));
        flushAndClear();

        var updated = medicineService.update(created.id(),
                updateReq("Azithral 500", "Alembic", new BigDecimal("5")));
        assertThat(updated.gstRate()).isEqualByComparingTo(new BigDecimal("5"));
    }

    @Test
    @DisplayName("deactivating then reactivating a medicine round-trips correctly")
    void deactivateAndReactivate() {
        var created = medicineService.create(createReq("Cetrizine 10", "Cipla", new BigDecimal("5")));
        flushAndClear();

        medicineService.deactivate(created.id());
        flushAndClear();
        assertThat(medicineRepository.findById(created.id()).orElseThrow().isActive()).isFalse();

        medicineService.activate(created.id());
        flushAndClear();
        assertThat(medicineRepository.findById(created.id()).orElseThrow().isActive()).isTrue();
    }

    @Test
    @DisplayName("an unknown medicine id is reported as not found")
    void unknownIdIsNotFound() {
        assertThatThrownBy(() -> medicineService.deactivate("does-not-exist"))
                .isInstanceOf(NotFoundException.class);
    }

    // ── Barcode ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("linking a barcode makes the medicine findable by that barcode")
    void barcodeLinkAndLookup() {
        var created = medicineService.create(createReq("Ibuprofen 400", "Sun Pharma", new BigDecimal("12")));
        flushAndClear();

        String barcode = "890" + unique();
        medicineService.setBarcode(created.id(), barcode);
        flushAndClear();

        assertThat(medicineService.findByBarcode(barcode).id()).isEqualTo(created.id());
    }

    @Test
    @DisplayName("linking a barcode already used by another medicine is rejected")
    void duplicateBarcodeRejected() {
        var first = medicineService.create(createReq("Med A", "Mfr A", new BigDecimal("12")));
        var second = medicineService.create(createReq("Med B", "Mfr B", new BigDecimal("12")));
        flushAndClear();

        String barcode = "890" + unique();
        medicineService.setBarcode(first.id(), barcode);
        flushAndClear();

        assertThatThrownBy(() -> medicineService.setBarcode(second.id(), barcode))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("looking up an unlinked barcode fails with a clear message rather than a generic error")
    void unlinkedBarcodeLookupFails() {
        assertThatThrownBy(() -> medicineService.findByBarcode("does-not-exist"))
                .isInstanceOf(NotFoundException.class)
                .hasMessageContaining("does-not-exist");
    }

    // ── Bulk import ──────────────────────────────────────────────────────────

    private BulkImportRequest.Row row(String name, String manufacturer) {
        return new BulkImportRequest.Row(name, "Generic", manufacturer, null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "10");
    }

    @Test
    @DisplayName("bulk import adds new rows and skips ones matching an existing active medicine")
    void bulkImportSkipsExistingDuplicates() {
        medicineService.create(createReq("Existing Med", "Existing Mfr", new BigDecimal("12")));
        flushAndClear();

        var result = medicineService.bulkImport(new BulkImportRequest(List.of(
                row("Existing Med", "Existing Mfr"),
                row("Brand New Med " + unique(), "New Mfr"))));

        assertThat(result.added()).isEqualTo(1);
        assertThat(result.skipped()).isEqualTo(1);
        assertThat(result.failed()).isEqualTo(0);
    }

    @Test
    @DisplayName("bulk import de-duplicates two identical rows within the same file")
    void bulkImportDedupesWithinFile() {
        String name = "Within File Dup " + unique();
        var result = medicineService.bulkImport(new BulkImportRequest(List.of(
                row(name, "Same Mfr"),
                row(name, "Same Mfr"))));

        assertThat(result.added()).isEqualTo(1);
        assertThat(result.skipped()).isEqualTo(1);
    }

    @Test
    @DisplayName("a bad row (invalid GST rate) fails independently without aborting the rest of the batch")
    void bulkImportBadRowFailsIndependently() {
        var badRow = new BulkImportRequest.Row("Bad Row " + unique(), "Generic", "Mfr", null, null, null, null,
                new BigDecimal("9"), "Tablet", "500mg", "strip", "10");

        var result = medicineService.bulkImport(new BulkImportRequest(List.of(
                badRow, row("Good Row " + unique(), "Mfr"))));

        assertThat(result.failed()).isEqualTo(1);
        assertThat(result.added()).isEqualTo(1);
        assertThat(result.parseErrors()).anySatisfy(e -> assertThat(e).contains("Bad Row"));
    }

    @Test
    @DisplayName("bulk import rejects an empty file")
    void bulkImportRejectsEmptyFile() {
        assertThatThrownBy(() -> medicineService.bulkImport(new BulkImportRequest(List.of())))
                .isInstanceOf(BadRequestException.class);
    }

    // ── Per-pharmacy overrides (tenant isolation) ─────────────────────────────

    @Test
    @DisplayName("a pharmacy's GST override on a shared medicine does not affect another pharmacy's view of it")
    void overrideIsTenantIsolated() {
        var shared = medicineService.create(createReq("Shared Medicine " + unique(), "Shared Mfr", new BigDecimal("12")));
        flushAndClear();

        medicineService.upsertOverride(shared.id(), new UpsertOverrideRequest(new BigDecimal("5"), null, "our override"));
        flushAndClear();

        assertThat(medicineService.listMyOverrides())
                .anySatisfy(o -> {
                    assertThat(o.medicineId()).isEqualTo(shared.id());
                    assertThat(o.gstRate()).isEqualByComparingTo(new BigDecimal("5"));
                });

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThat(medicineService.listMyOverrides())
                .noneSatisfy(o -> assertThat(o.medicineId()).isEqualTo(shared.id()));
    }

    @Test
    @DisplayName("removing an override reverts to the catalog's base GST rate for that pharmacy")
    void removingOverrideReverts() {
        var shared = medicineService.create(createReq("Revert Medicine " + unique(), "Mfr", new BigDecimal("18")));
        flushAndClear();

        medicineService.upsertOverride(shared.id(), new UpsertOverrideRequest(new BigDecimal("5"), null, null));
        flushAndClear();
        assertThat(medicineService.listMyOverrides()).anySatisfy(o -> assertThat(o.medicineId()).isEqualTo(shared.id()));

        medicineService.removeOverride(shared.id());
        flushAndClear();
        assertThat(medicineService.listMyOverrides()).noneSatisfy(o -> assertThat(o.medicineId()).isEqualTo(shared.id()));
    }

    @Test
    @DisplayName("an override with neither a GST rate nor a discount is rejected")
    void emptyOverrideRejected() {
        var shared = medicineService.create(createReq("Empty Override Medicine " + unique(), "Mfr", new BigDecimal("12")));
        flushAndClear();

        assertThatThrownBy(() -> medicineService.upsertOverride(shared.id(), new UpsertOverrideRequest(null, null, null)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("an override GST rate outside the allowed set is rejected")
    void overrideWithInvalidGstRateRejected() {
        var shared = medicineService.create(createReq("Bad Override Medicine " + unique(), "Mfr", new BigDecimal("12")));
        flushAndClear();

        assertThatThrownBy(() -> medicineService.upsertOverride(shared.id(),
                new UpsertOverrideRequest(new BigDecimal("9"), null, null)))
                .isInstanceOf(BadRequestException.class);
    }

    // ── Alternatives (generic substitution) ───────────────────────────────────

    @Test
    @DisplayName("alternatives returns other active medicines sharing generic name/strength/form, with this pharmacy's own stock and its own GST override")
    void alternativesReflectsCallerPharmacysStockAndOverride() {
        var source = medicineService.create(createReq("Original Brand " + unique(), "Mfr One", new BigDecimal("12")));
        var alt = medicineService.create(createReq("Alt Brand " + unique(), "Mfr Two", new BigDecimal("12")));
        flushAndClear();

        // Both share the same genericName/strength/form set by createReq().
        medicineService.upsertOverride(alt.id(), new UpsertOverrideRequest(new BigDecimal("5"), null, null));
        inventoryRepository.save(Inventory.create(pharmacyId, alt.id(), "BATCH-ALT",
                Instant.now().plus(365, ChronoUnit.DAYS), 40,
                new BigDecimal("20.00"), new BigDecimal("40.00"), 10, 5));
        flushAndClear();

        var alternatives = medicineService.getAlternatives(source.id(), pharmacyId);

        assertThat(alternatives).anySatisfy(a -> {
            assertThat(a.id()).isEqualTo(alt.id());
            assertThat(a.gstRate()).isEqualByComparingTo(new BigDecimal("5"));
            assertThat(a.totalStock()).isEqualTo(40);
            assertThat(a.stockStatus()).isEqualTo("in_stock");
        });
        assertThat(alternatives).noneSatisfy(a -> assertThat(a.id()).isEqualTo(source.id()));
    }

    @Test
    @DisplayName("alternatives does not leak another pharmacy's stock onto a shared medicine")
    void alternativesDoesNotLeakAnotherPharmacysStock() {
        var source = medicineService.create(createReq("Src Brand " + unique(), "Mfr One", new BigDecimal("12")));
        var alt = medicineService.create(createReq("Alt Brand2 " + unique(), "Mfr Two", new BigDecimal("12")));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        inventoryRepository.save(Inventory.create(other.getId(), alt.id(), "BATCH-OTHER",
                Instant.now().plus(365, ChronoUnit.DAYS), 999,
                new BigDecimal("20.00"), new BigDecimal("40.00"), 10, 5));
        flushAndClear();

        var alternatives = medicineService.getAlternatives(source.id(), pharmacyId);

        assertThat(alternatives).anySatisfy(a -> {
            assertThat(a.id()).isEqualTo(alt.id());
            assertThat(a.totalStock()).isEqualTo(0);
            assertThat(a.stockStatus()).isEqualTo("out_of_stock");
        });
    }

    @Test
    @DisplayName("a medicine without a generic name has no alternatives")
    void noGenericNameMeansNoAlternatives() {
        var lone = medicineService.create(new CreateMedicineRequest("Lone Medicine " + unique(), null, "Mfr",
                null, null, null, null, new BigDecimal("12"), "Tablet", "250mg", "strip", "10"));
        flushAndClear();

        assertThat(medicineService.getAlternatives(lone.id(), pharmacyId)).isEmpty();
    }

    // ── Quick search ───────────────────────────────────────────────────────

    @Test
    @DisplayName("quick search matches by name and excludes inactive medicines")
    void quickSearchExcludesInactive() {
        String uniqueName = "Findable Med " + unique();
        var created = medicineService.create(createReq(uniqueName, "Mfr", new BigDecimal("12")));
        flushAndClear();

        assertThat(medicineService.quickSearch(uniqueName, 10))
                .anySatisfy(m -> assertThat(m.id()).isEqualTo(created.id()));

        medicineService.deactivate(created.id());
        flushAndClear();

        assertThat(medicineService.quickSearch(uniqueName, 10))
                .noneSatisfy(m -> assertThat(m.id()).isEqualTo(created.id()));
    }

    @Test
    @DisplayName("quick search ranks a name match above a mere genericName match, not alphabetically")
    void quickSearchRanksNameMatchAboveGenericMatch() {
        String term = "Findpara" + unique();
        // Its own name doesn't contain the search term at all — matches only because
        // its genericName happens to equal it. Alphabetically "A..." would sort first.
        var byGenericOnly = medicineService.create(new CreateMedicineRequest(
                "A Other Brand " + unique(), term, "Mfr", null, null, null, null,
                new BigDecimal("12"), "Suspension", "250mg", "bottle", "60 ml"));
        // Its own name starts with the search term — this is the one a pharmacist
        // typing "findpara..." actually means, and must rank first.
        var byNamePrefix = medicineService.create(new CreateMedicineRequest(
                term + " 500mg Tablet", "Ibuprofen", "Mfr", null, null, null, null,
                new BigDecimal("12"), "Tablet", "500mg", "strip", "10 tablets"));
        flushAndClear();

        assertThat(medicineService.quickSearch(term, 10))
                .extracting(m -> m.id())
                .containsExactly(byNamePrefix.id(), byGenericOnly.id());
    }

    @Test
    @DisplayName("quick search falls back to trigram similarity for a one-letter typo")
    void quickSearchToleratesTypo() {
        String suffix = unique();
        var created = medicineService.create(createReq("Zolmitriptanum" + suffix + " Tablet", "Mfr", new BigDecimal("12")));
        flushAndClear();

        // m -> n: confirms the literal-substring tier alone genuinely misses this,
        // so a hit below proves the fuzzy fallback fired rather than some other tier.
        String typo = "Zolmitriptanun" + suffix;
        assertThat(medicineRepository.quickSearch(typo, PageRequest.of(0, 10))).isEmpty();

        assertThat(medicineService.quickSearch(typo, 10))
                .anySatisfy(m -> assertThat(m.id()).isEqualTo(created.id()));
    }

    @Test
    @DisplayName("quick search tolerates a transposed word order via trigram fallback")
    void quickSearchToleratesWordOrderTranspose() {
        String suffix = unique();
        var created = medicineService.create(createReq("Nefodryl" + suffix + " 250mg", "Mfr", new BigDecimal("12")));
        flushAndClear();

        // The catalogue name has the strength after the brand token; a pharmacist
        // typing it the other way round shouldn't come up empty.
        String transposed = "250mg Nefodryl" + suffix;
        assertThat(medicineRepository.quickSearch(transposed, PageRequest.of(0, 10))).isEmpty();

        assertThat(medicineService.quickSearch(transposed, 10))
                .anySatisfy(m -> assertThat(m.id()).isEqualTo(created.id()));
    }

    @Test
    @DisplayName("quick search matches by composition, not just name/genericName/manufacturer")
    void quickSearchMatchesByComposition() {
        String token = "Cafmol" + unique();
        var created = medicineService.create(new CreateMedicineRequest(
                "Brand " + unique(), "Paracetamol", "Mfr", token + " 500mg + Caffeine 30mg",
                null, null, null, new BigDecimal("12"), "Tablet", "500mg", "strip", "10"));
        flushAndClear();

        assertThat(medicineService.quickSearch(token, 10))
                .anySatisfy(m -> assertThat(m.id()).isEqualTo(created.id()));
    }
}
