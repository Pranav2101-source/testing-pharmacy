package com.checkup.pharmacy.modules.doctor;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.doctor.dto.DoctorRequest;
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

/** Doctor (referrer) master CRUD — simple, no financial fields. */
@Transactional
class DoctorIT extends AbstractPostgresIT {

    @Autowired private DoctorService doctorService;
    @Autowired private DoctorRepository doctorRepository;
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

    private DoctorRequest request(String name) {
        return new DoctorRequest(name, "REG-" + unique(), "General Medicine", "City Clinic",
                "9876543210", null, null);
    }

    @Test
    @DisplayName("a created doctor is listed for this pharmacy")
    void createdDoctorIsListed() {
        doctorService.create(request("Dr Rao"));
        flushAndClear();

        var result = doctorService.list(null, 1, 50);
        assertThat(result.data()).anySatisfy(d -> assertThat(d.name()).isEqualTo("Dr Rao"));
    }

    @Test
    @DisplayName("a new doctor starts active")
    void newDoctorIsActive() {
        var created = doctorService.create(request("Dr Rao"));
        assertThat(created.isActive()).isTrue();
    }

    @Test
    @DisplayName("deactivating then reactivating a doctor round-trips correctly")
    void deactivateAndReactivate() {
        var created = doctorService.create(request("Dr Rao"));
        flushAndClear();

        doctorService.deactivate(created.id());
        flushAndClear();
        assertThat(doctorRepository.findById(created.id()).orElseThrow().isActive()).isFalse();

        doctorService.reactivate(created.id());
        flushAndClear();
        assertThat(doctorRepository.findById(created.id()).orElseThrow().isActive()).isTrue();
    }

    @Test
    @DisplayName("updating a doctor's details persists")
    void updatePersists() {
        var created = doctorService.create(request("Dr Rao"));
        flushAndClear();

        doctorService.update(created.id(), new DoctorRequest("Dr Rao Updated", "REG-NEW",
                "Cardiology", "New Clinic", "9111111111", "dr@test.local", "New Address"));
        flushAndClear();

        var updated = doctorRepository.findById(created.id()).orElseThrow();
        assertThat(updated.getName()).isEqualTo("Dr Rao Updated");
        assertThat(updated.getSpecialty()).isEqualTo("Cardiology");
    }

    @Test
    @DisplayName("another pharmacy's doctor is not visible")
    void cannotAccessAnotherPharmacysDoctor() {
        var created = doctorService.create(request("Dr Rao"));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> doctorService.update(created.id(), request("Hijacked")))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> doctorService.deactivate(created.id()))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("another pharmacy's doctors do not appear in this pharmacy's list")
    void listIsTenantScoped() {
        doctorService.create(request("This Pharmacy's Doctor"));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        doctorService.create(request("Other Pharmacy's Doctor"));
        flushAndClear();

        var result = doctorService.list(null, 1, 50);
        assertThat(result.data())
                .extracting(d -> d.name())
                .contains("Other Pharmacy's Doctor")
                .doesNotContain("This Pharmacy's Doctor");
    }
}
