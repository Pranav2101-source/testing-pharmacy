package com.checkup.pharmacy.modules.location;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.location.dto.CreateRackRequest;
import com.checkup.pharmacy.modules.location.dto.CreateShelfRequest;
import com.checkup.pharmacy.modules.location.dto.UpdateRackRequest;
import com.checkup.pharmacy.modules.location.dto.UpdateShelfRequest;
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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Rack/shelf storage locations — tenant-scoped, codes unique per pharmacy. */
@Transactional
class LocationIT extends AbstractPostgresIT {

    @Autowired private LocationService locationService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String ownerId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        ownerId = user.getId();
        flushAndClear();
        authenticateAs(ownerId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private CreateRackRequest rackReq(String code, String name) {
        return new CreateRackRequest(code, name, "Aisle 1");
    }

    // ── Racks ────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a created rack is listed and starts active")
    void createdRackIsListedAndActive() {
        locationService.createRack(rackReq("R1-" + unique(), "Rack One"));
        flushAndClear();

        var result = locationService.listRacks(false, 1, 50);
        assertThat(result.items()).anySatisfy(r -> assertThat(r.isActive()).isTrue());
    }

    @Test
    @DisplayName("a rack code is normalized (trimmed, upper-cased)")
    void rackCodeIsNormalized() {
        String code = "r2-" + unique();
        var created = locationService.createRack(rackReq("  " + code + "  ", "Rack Two"));
        assertThat(created.code()).isEqualTo(code.trim().toUpperCase(java.util.Locale.ROOT));
    }

    @Test
    @DisplayName("two racks with the same code in one pharmacy are rejected")
    void duplicateRackCodeRejected() {
        String code = "DUP-" + unique();
        locationService.createRack(rackReq(code, "First Rack"));
        flushAndClear();

        assertThatThrownBy(() -> locationService.createRack(rackReq(code, "Second Rack")))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("the same rack code is fine across two different pharmacies")
    void sameRackCodeAllowedAcrossPharmacies() {
        String code = "SHARED-" + unique();
        locationService.createRack(rackReq(code, "First Pharmacy Rack"));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        var created = locationService.createRack(rackReq(code, "Other Pharmacy Rack"));
        assertThat(created.id()).isNotBlank();
    }

    @Test
    @DisplayName("updating a rack's code to one already used by another rack is rejected")
    void updateToConflictingRackCodeRejected() {
        String codeA = "A-" + unique();
        String codeB = "B-" + unique();
        locationService.createRack(rackReq(codeA, "Rack A"));
        var rackB = locationService.createRack(rackReq(codeB, "Rack B"));
        flushAndClear();

        assertThatThrownBy(() -> locationService.updateRack(rackB.id(), new UpdateRackRequest(codeA, null, null, null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("a partial rack update leaves omitted fields (name, aisle) unchanged")
    void partialRackUpdateLeavesOtherFieldsUnchanged() {
        var created = locationService.createRack(rackReq("P-" + unique(), "Original Name"));
        flushAndClear();

        var updated = locationService.updateRack(created.id(), new UpdateRackRequest(null, null, null, false));

        assertThat(updated.name()).isEqualTo("Original Name");
        assertThat(updated.aisle()).isEqualTo("Aisle 1");
        assertThat(updated.isActive()).isFalse();
    }

    @Test
    @DisplayName("an empty-string rack name in an update does not blank out the existing name")
    void emptyStringRackNameDoesNotBlankExisting() {
        var created = locationService.createRack(rackReq("E-" + unique(), "Keep This Name"));
        flushAndClear();

        var updated = locationService.updateRack(created.id(), new UpdateRackRequest(null, "", null, null));
        assertThat(updated.name()).isEqualTo("Keep This Name");
    }

    @Test
    @DisplayName("an unknown rack id is reported as not found")
    void unknownRackIdIsNotFound() {
        assertThatThrownBy(() -> locationService.updateRack("does-not-exist", new UpdateRackRequest(null, null, null, false)))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("another pharmacy's racks do not appear in this pharmacy's list")
    void listIsTenantScoped() {
        locationService.createRack(rackReq("MINE-" + unique(), "My Rack"));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        locationService.createRack(rackReq("THEIRS-" + unique(), "Their Rack"));
        flushAndClear();

        var result = locationService.listRacks(false, 1, 50);
        assertThat(result.items()).extracting(r -> r.name())
                .contains("Their Rack")
                .doesNotContain("My Rack");
    }

    // ── Shelves ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a created shelf is linked to its rack and appears in the rack's shelf ids")
    void createdShelfLinksToRack() {
        var rack = locationService.createRack(rackReq("SR-" + unique(), "Shelf Rack"));
        flushAndClear();

        var shelf = locationService.createShelf(new CreateShelfRequest(rack.id(), "S1-" + unique(), 1, "Top shelf"));
        flushAndClear();

        assertThat(shelf.rack().id()).isEqualTo(rack.id());
        var listed = locationService.listRacks(false, 1, 50);
        assertThat(listed.items()).anySatisfy(r -> {
            if (r.id().equals(rack.id())) {
                assertThat(r.shelves()).extracting(s -> s.id()).contains(shelf.id());
            }
        });
    }

    @Test
    @DisplayName("creating a shelf under another pharmacy's rack is rejected")
    void creatingShelfUnderAnotherPharmacysRackRejected() {
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        var otherRack = locationService.createRack(rackReq("OR-" + unique(), "Other Rack"));
        flushAndClear();

        authenticateAs(ownerId, pharmacyId, Role.OWNER);
        assertThatThrownBy(() -> locationService.createShelf(
                new CreateShelfRequest(otherRack.id(), "HIJACK-" + unique(), 1, null)))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("two shelves with the same code in one pharmacy are rejected, even under different racks")
    void duplicateShelfCodeRejectedAcrossRacks() {
        var rackA = locationService.createRack(rackReq("RA-" + unique(), "Rack A"));
        var rackB = locationService.createRack(rackReq("RB-" + unique(), "Rack B"));
        flushAndClear();

        String shelfCode = "SDUP-" + unique();
        locationService.createShelf(new CreateShelfRequest(rackA.id(), shelfCode, 1, null));
        flushAndClear();

        assertThatThrownBy(() -> locationService.createShelf(new CreateShelfRequest(rackB.id(), shelfCode, 1, null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("a partial shelf update leaves the omitted level unchanged")
    void partialShelfUpdateLeavesLevelUnchanged() {
        var rack = locationService.createRack(rackReq("SL-" + unique(), "Shelf Level Rack"));
        flushAndClear();
        var shelf = locationService.createShelf(new CreateShelfRequest(rack.id(), "LV-" + unique(), 3, "desc"));
        flushAndClear();

        var updated = locationService.updateShelf(shelf.id(), new UpdateShelfRequest(null, null, "new desc", null));

        assertThat(updated.level()).isEqualTo(3);
        assertThat(updated.description()).isEqualTo("new desc");
    }

    @Test
    @DisplayName("an unknown shelf id is reported as not found")
    void unknownShelfIdIsNotFound() {
        assertThatThrownBy(() -> locationService.updateShelf("does-not-exist",
                new UpdateShelfRequest(null, null, null, false)))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("another pharmacy's shelves do not appear in this pharmacy's list")
    void shelfListIsTenantScoped() {
        var rack = locationService.createRack(rackReq("TSR-" + unique(), "Tenant Scoped Rack"));
        flushAndClear();
        locationService.createShelf(new CreateShelfRequest(rack.id(), "MINE-SHELF-" + unique(), 1, null));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        var otherRack = locationService.createRack(rackReq("TSR2-" + unique(), "Other Tenant Rack"));
        flushAndClear();
        locationService.createShelf(new CreateShelfRequest(otherRack.id(), "THEIRS-SHELF-" + unique(), 1, null));
        flushAndClear();

        var result = locationService.listShelves(false, 1, 50);
        assertThat(result.items()).allSatisfy(s -> assertThat(s.rack().id()).isEqualTo(otherRack.id()));
    }
}
