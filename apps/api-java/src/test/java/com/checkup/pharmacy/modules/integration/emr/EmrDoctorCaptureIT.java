package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Local-only verification for EMR doctor auto-capture — NOT meant to be committed (see
 * feedback_no_test_files_in_commits memory).
 *
 * <p>Confirms doctorId gets resolved and reused by exact registrationNo match, and stays null
 * when the clinic sends no regNo (never guessed from name alone).
 */
@Transactional
class EmrDoctorCaptureIT extends AbstractPostgresIT {

    @Autowired private EmrIntegrationService emrIntegrationService;
    @Autowired private DoctorRepository doctorRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        User user = userRepository.save(User.create(pharmacyId, "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        entityManager.flush();
        entityManager.clear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private EmrPrescriptionIngestRequest request(String externalRxId, String doctorName, String doctorRegNo) {
        return new EmrPrescriptionIngestRequest("tenant-1", externalRxId, null, doctorName, doctorRegNo, null,
                "A Patient", null, null, null, null, null, null,
                List.of(new EmrPrescriptionIngestRequest.Item("item-1", "Totally Unknown Medicine " + unique(),
                        null, null, null, 1, null, null, null)));
    }

    @Test
    @DisplayName("same doctor regNo across two prescriptions reuses one Doctor row, not two")
    void sameRegNoReusesOneDoctorAcrossPrescriptions() {
        var first = emrIntegrationService.ingest(request("rx-" + unique(), "Dr. Mehta", "MCI-99887"));
        var second = emrIntegrationService.ingest(request("rx-" + unique(), "Dr. Mehta", "MCI-99887"));

        Prescription firstRx = prescriptionOf(first.pharmacyPrescriptionId());
        Prescription secondRx = prescriptionOf(second.pharmacyPrescriptionId());

        assertThat(firstRx.getDoctorId()).isNotNull();
        assertThat(secondRx.getDoctorId()).isEqualTo(firstRx.getDoctorId());
        assertThat(doctorRepository.findByPharmacyIdAndRegistrationNo(pharmacyId, "MCI-99887")).isPresent();
    }

    @Test
    @DisplayName("no regNo means no auto-link — never guessed from name alone")
    void blankRegNoLeavesDoctorUnlinked() {
        var result = emrIntegrationService.ingest(request("rx-" + unique(), "Dr. NoRegNo", null));

        assertThat(prescriptionOf(result.pharmacyPrescriptionId()).getDoctorId()).isNull();
    }

    private Prescription prescriptionOf(String id) {
        entityManager.flush();
        entityManager.clear();
        return entityManager.find(Prescription.class, id);
    }
}
