package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.integration.emr.EmrPrescriptionIntake;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicIngestResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("Clinic ingest adapter: translates without deciding")
class ClinicIngestServiceTest {

    private final EmrPrescriptionIntake intake = mock(EmrPrescriptionIntake.class);
    private final PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
    private final ClinicIngestService service = new ClinicIngestService(intake, prescriptionRepository);

    @BeforeEach
    void tenant() {
        var principal = new UserPrincipal("user-1", "ph_1", Role.OWNER, "owner@pharmacy.test");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("all clinical fields survive translation to the native shape")
    void translatesCoreFields() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(intake.ingest(any())).thenReturn(snapshot());

        service.ingest(fullRequest());

        EmrPrescriptionIngestRequest native_ = captureNativeRequest();
        assertThat(native_.externalTenantId()).isEqualTo("clinic-apollo-01");
        assertThat(native_.externalPrescriptionId()).isEqualTo("rx-778");
        assertThat(native_.doctorName()).isEqualTo("Dr. Meera Rao");
        assertThat(native_.patientName()).isEqualTo("Asha Verma");
        assertThat(native_.items()).hasSize(1);
        assertThat(native_.items().get(0).externalItemId()).isEqualTo("item-1");
        assertThat(native_.items().get(0).medicineName()).isEqualTo("Paracetamol 500mg");
        assertThat(native_.items().get(0).quantity()).isEqualTo(10);
    }

    @Test
    @DisplayName("dosing detail with no native column is folded into the item's notes, not dropped")
    void foldsUnmappedDosingDetailIntoNotes() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(intake.ingest(any())).thenReturn(snapshot());

        service.ingest(fullRequest());

        String notes = captureNativeRequest().items().get(0).notes();
        assertThat(notes).contains("Twice daily");
        assertThat(notes).contains("Oral");
        assertThat(notes).contains("After food");
        assertThat(notes).contains("Do not skip doses");
    }

    @Test
    @DisplayName("a garbled phone number is dropped rather than failing the whole prescription")
    void dropsAnUnusablePhoneRatherThanRejecting() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(intake.ingest(any())).thenReturn(snapshot());

        ClinicIngestRequest request = new ClinicIngestRequest(
                "clinic-apollo-01", "rx-778", null, null, null,
                new ClinicIngestRequest.Patient(null, "Asha Verma", null, "not-a-phone-number", null, null),
                new ClinicIngestRequest.Doctor(null, "Dr. Meera Rao", null, null, null),
                List.of(new ClinicIngestRequest.Item("item-1", "Paracetamol 500mg", null, null,
                        null, null, null, null, 10, null, null, null)));

        service.ingest(request);

        assertThat(captureNativeRequest().patientPhone()).isNull();
    }

    @Test
    @DisplayName("a missing quantity ingests as zero and is counted, not rejected")
    void countsAMissingQuantityRatherThanFailing() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(any(), any(), any()))
                .thenReturn(Optional.empty());
        // intake is mocked, so this stubs what the REAL ingest pipeline would actually produce for
        // a line with no quantity, no dosage and no duration: PrescriptionQuantityCalculator has
        // nothing to work with, so the line stays at the zero placeholder — still unconfirmed, not
        // silently resolved. See countsAResolvedCalculatedQuantityAsNotUnconfirmed below for the
        // sibling case where dosage + duration DO let ingest resolve it.
        when(intake.ingest(any())).thenReturn(new EmrPrescriptionSnapshot("ph_1", "rx_1", "RX-000001",
                "clinic-apollo-01", "rx-778", null, "RECEIVED", Instant.now(),
                List.of(new EmrPrescriptionSnapshot.Item("item-1", "med_1", "Paracetamol 500mg", 0, 0)),
                List.of()));

        ClinicIngestRequest request = new ClinicIngestRequest(
                "clinic-apollo-01", "rx-778", null, null, null,
                new ClinicIngestRequest.Patient(null, "Asha Verma", null, null, null, null),
                new ClinicIngestRequest.Doctor(null, "Dr. Meera Rao", null, null, null),
                List.of(new ClinicIngestRequest.Item("item-1", "Paracetamol 500mg", null, null,
                        null, null, null, null, null, null, null, null)));

        ClinicIngestResponse response = service.ingest(request);

        assertThat(captureNativeRequest().items().get(0).quantity()).isZero();
        assertThat(response.unconfirmedQuantityCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("a quantity ingest calculated from dosage + duration is NOT counted as still unconfirmed")
    void countsAResolvedCalculatedQuantityAsNotUnconfirmed() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(any(), any(), any()))
                .thenReturn(Optional.empty());
        // The clinic sent no quantity, but ingest (the real EmrIntegrationService, mocked out
        // here) was able to calculate one from dosage + duration — the stored line, and
        // therefore this response, must reflect the RESOLVED state, not the request's original
        // gap. Regression test for the count having been read off the request instead of the
        // stored snapshot, which reported a line as still needing a pharmacist after ingest had
        // already settled it.
        when(intake.ingest(any())).thenReturn(new EmrPrescriptionSnapshot("ph_1", "rx_1", "RX-000001",
                "clinic-apollo-01", "rx-778", null, "RECEIVED", Instant.now(),
                List.of(new EmrPrescriptionSnapshot.Item("item-1", "med_1", "Paracetamol 500mg", 12, 0)),
                List.of()));

        ClinicIngestRequest request = new ClinicIngestRequest(
                "clinic-apollo-01", "rx-778", null, null, null,
                new ClinicIngestRequest.Patient(null, "Asha Verma", null, null, null, null),
                new ClinicIngestRequest.Doctor(null, "Dr. Meera Rao", null, null, null),
                List.of(new ClinicIngestRequest.Item("item-1", "Paracetamol 500mg", null, null,
                        null, "1-0-1", null, "6 days", null, null, null, null)));

        ClinicIngestResponse response = service.ingest(request);

        assertThat(response.unconfirmedQuantityCount())
                .as("ingest already resolved this line to 12 — nothing left for a pharmacist to confirm")
                .isZero();
    }

    @Test
    @DisplayName("an unmatched line is counted in the response, not treated as an error")
    void countsUnmatchedItems() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(intake.ingest(any())).thenReturn(new EmrPrescriptionSnapshot(
                "ph_1", "rx_1", "RX-000001", "clinic-apollo-01", "rx-778", null, "RECEIVED",
                Instant.now(),
                List.of(new EmrPrescriptionSnapshot.Item("item-1", null, "Unrecognised Brand", 10, 0)),
                List.of()));

        ClinicIngestResponse response = service.ingest(fullRequest());

        assertThat(response.unmatchedItemCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("alreadyExisted reflects whether the prescription was present before ingest ran")
    void reportsWhetherThePrescriptionAlreadyExisted() {
        when(prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId("ph_1", "clinic-apollo-01", "rx-778"))
                .thenReturn(Optional.of(mock(com.checkup.pharmacy.modules.prescription.Prescription.class)));
        when(intake.ingest(any())).thenReturn(snapshot());

        ClinicIngestResponse response = service.ingest(fullRequest());

        assertThat(response.alreadyExisted()).isTrue();
    }

    private EmrPrescriptionIngestRequest captureNativeRequest() {
        ArgumentCaptor<EmrPrescriptionIngestRequest> captor =
                ArgumentCaptor.forClass(EmrPrescriptionIngestRequest.class);
        org.mockito.Mockito.verify(intake).ingest(captor.capture());
        return captor.getValue();
    }

    private static ClinicIngestRequest fullRequest() {
        return new ClinicIngestRequest(
                "clinic-apollo-01", "rx-778", "RX-778", Instant.now(), "Follow up in 2 weeks",
                new ClinicIngestRequest.Patient("pat-1", "Asha Verma", 34, "+91 98765 43210", "F", "AB12CD3456"),
                new ClinicIngestRequest.Doctor("doc-1", "Dr. Meera Rao", "MH-12345", "9876500000", "General Medicine"),
                List.of(new ClinicIngestRequest.Item("item-1", "Paracetamol 500mg", "Paracetamol",
                        "500mg", "Tablet", "1-0-1", "Twice daily", "5 days", 10, "Oral", "After food",
                        "Do not skip doses")));
    }

    private static EmrPrescriptionSnapshot snapshot() {
        return new EmrPrescriptionSnapshot("ph_1", "rx_1", "RX-000001", "clinic-apollo-01", "rx-778",
                null, "RECEIVED", Instant.now(),
                List.of(new EmrPrescriptionSnapshot.Item("item-1", "med_1", "Paracetamol 500mg", 10, 0)),
                List.of());
    }
}
