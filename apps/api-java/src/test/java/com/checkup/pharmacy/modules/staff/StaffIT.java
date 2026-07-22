package com.checkup.pharmacy.modules.staff;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.staff.dto.CreateStaffRequest;
import com.checkup.pharmacy.modules.staff.dto.UpdateStaffRequest;
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

/**
 * Staff (team member) management — the one invariant enforced everywhere is
 * that a pharmacy can never be left with zero active owners.
 *
 * <p>Review found a real gap shared with three other user-creation paths
 * (AuthService.register, PharmacyOnboardingService.onboard,
 * SupportService.createAgent): {@code existsByEmail} was checked against the
 * raw, un-normalized input while {@link User#create} — only here in
 * StaffService — separately lower-cased the value actually stored. A
 * differently-cased or padded duplicate ("  Owner@Test.com") would sail past
 * the check, and — more importantly — a user who signed up with any uppercase
 * letter in their email could never log back in, since the DB comparison was
 * case-sensitive. Fixed at the two real choke points instead of patching each
 * call site: {@link User#create} now normalizes (trim + lower-case) on every
 * write, and {@code UserRepository.existsByEmail}/{@code findByEmail} now
 * compare case/whitespace-insensitively. {@link #duplicateEmailRejectedRegardlessOfCaseOrWhitespace}
 * pins it from this module's angle.
 */
@Transactional
class StaffIT extends AbstractPostgresIT {

    @Autowired private StaffService staffService;
    @Autowired private UserRepository userRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String ownerId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User owner = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        ownerId = owner.getId();
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

    private CreateStaffRequest request(String email, Role role) {
        return new CreateStaffRequest("Staff Member", email, "9876543210", role, "password123");
    }

    @Test
    @DisplayName("a created staff member is listed for this pharmacy")
    void createdStaffIsListed() {
        staffService.create(request("cashier-" + unique() + "@test.local", Role.CASHIER));
        flushAndClear();

        assertThat(staffService.list()).anySatisfy(s -> assertThat(s.role()).isEqualTo("CASHIER"));
    }

    @Test
    @DisplayName("a new staff member cannot be created as Owner")
    void cannotCreateAsOwner() {
        assertThatThrownBy(() -> staffService.create(request("new-owner-" + unique() + "@test.local", Role.OWNER)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("a duplicate email is rejected regardless of case or surrounding whitespace")
    void duplicateEmailRejectedRegardlessOfCaseOrWhitespace() {
        String email = "pharmacist-" + unique() + "@test.local";
        staffService.create(request(email, Role.PHARMACIST));
        flushAndClear();

        String differentlyCased = "  " + email.substring(0, 1).toUpperCase() + email.substring(1).toUpperCase() + "  ";
        assertThatThrownBy(() -> staffService.create(request(differentlyCased, Role.CASHIER)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("a staff member created with mixed-case email is stored normalized and findable via User.email lookups")
    void createdEmailIsStoredNormalized() {
        String rawEmail = "MixedCase-" + unique() + "@Test.Local";
        var created = staffService.create(request(rawEmail, Role.MANAGER));
        flushAndClear();

        User stored = userRepository.findById(created.id()).orElseThrow();
        assertThat(stored.getEmail()).isEqualTo(rawEmail.trim().toLowerCase(java.util.Locale.ROOT));
        assertThat(userRepository.existsByEmail(rawEmail.toUpperCase())).isTrue();
    }

    @Test
    @DisplayName("demoting the last active owner is refused")
    void cannotDemoteLastActiveOwner() {
        assertThatThrownBy(() -> staffService.update(ownerId, new UpdateStaffRequest(null, null, Role.MANAGER, null)))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("owner");
    }

    @Test
    @DisplayName("deactivating the last active owner is refused")
    void cannotDeactivateLastActiveOwner() {
        assertThatThrownBy(() -> staffService.deactivate(ownerId))
                .isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> staffService.update(ownerId, new UpdateStaffRequest(null, null, null, false)))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("demoting a second owner is allowed once another active owner remains")
    void demotingASecondOwnerIsAllowedWhenAnotherRemains() {
        var secondOwner = staffService.create(request("owner2-" + unique() + "@test.local", Role.MANAGER));
        flushAndClear();
        staffService.update(secondOwner.id(), new UpdateStaffRequest(null, null, Role.OWNER, null));
        flushAndClear();

        // Now two active owners exist — demoting the original one must be allowed.
        var updated = staffService.update(ownerId, new UpdateStaffRequest(null, null, Role.MANAGER, null));
        assertThat(updated.role()).isEqualTo("MANAGER");
    }

    @Test
    @DisplayName("deactivating a non-owner staff member succeeds")
    void deactivatingNonOwnerSucceeds() {
        var staff = staffService.create(request("cashier2-" + unique() + "@test.local", Role.CASHIER));
        flushAndClear();

        staffService.deactivate(staff.id());
        flushAndClear();

        assertThat(userRepository.findById(staff.id()).orElseThrow().isActive()).isFalse();
    }

    @Test
    @DisplayName("an unknown staff id is reported as not found")
    void unknownIdIsNotFound() {
        assertThatThrownBy(() -> staffService.deactivate("does-not-exist"))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("another pharmacy's staff member is not visible or editable")
    void cannotAccessAnotherPharmacysStaff() {
        var staff = staffService.create(request("cashier3-" + unique() + "@test.local", Role.CASHIER));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherOwner = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-owner-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> staffService.deactivate(staff.id()))
                .isInstanceOf(NotFoundException.class);
        assertThat(staffService.list()).noneSatisfy(s -> assertThat(s.id()).isEqualTo(staff.id()));
    }

    @Test
    @DisplayName("updating name and phone persists without touching role or active state")
    void updateNameAndPhonePersists() {
        var staff = staffService.create(request("cashier4-" + unique() + "@test.local", Role.CASHIER));
        flushAndClear();

        var updated = staffService.update(staff.id(), new UpdateStaffRequest("Renamed Staff", "9123456789", null, null));

        assertThat(updated.name()).isEqualTo("Renamed Staff");
        assertThat(updated.phone()).isEqualTo("9123456789");
        assertThat(updated.role()).isEqualTo("CASHIER");
        assertThat(updated.isActive()).isTrue();
    }
}
