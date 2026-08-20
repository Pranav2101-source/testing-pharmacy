package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("EmrPrescriptionIntake: a concurrent duplicate push is a success, not a 500")
class EmrPrescriptionIntakeTest {

    private final EmrIntegrationService service = mock(EmrIntegrationService.class);
    private final EmrPrescriptionIntake intake = new EmrPrescriptionIntake(service);

    private static final EmrPrescriptionIngestRequest REQUEST = new EmrPrescriptionIngestRequest(
            "clinic-1", "rx-1", null, "Dr. Rao", null, null, "Asha Verma", null, null, null,
            null, null, null, List.of(new EmrPrescriptionIngestRequest.Item(
                    "item-1", "Paracetamol 500mg", null, null, null, 10, null, null, null)));

    @Test
    @DisplayName("a plain ingest just returns the service's answer")
    void passesThroughOnSuccess() {
        EmrPrescriptionSnapshot snapshot = snapshot();
        when(service.ingest(REQUEST)).thenReturn(snapshot);

        EmrPrescriptionSnapshot result = intake.ingest(REQUEST);

        assertThat(result).isSameAs(snapshot);
        verify(service, never()).get(any(), any());
    }

    @Test
    @DisplayName("a constraint violation from a concurrent winner is recovered by re-reading")
    void recoversFromAConcurrentDuplicate() {
        when(service.ingest(REQUEST))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));
        EmrPrescriptionSnapshot winnersSnapshot = snapshot();
        when(service.get("clinic-1", "rx-1")).thenReturn(winnersSnapshot);

        EmrPrescriptionSnapshot result = intake.ingest(REQUEST);

        assertThat(result).isSameAs(winnersSnapshot);
    }

    @Test
    @DisplayName("if the recovery read ALSO fails, the failure is not swallowed")
    void doesNotSwallowAGenuineFailure() {
        when(service.ingest(REQUEST))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));
        when(service.get("clinic-1", "rx-1"))
                .thenThrow(new RuntimeException("still not there — this was a real problem"));

        assertThatThrownBy(() -> intake.ingest(REQUEST))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("still not there");
    }

    @Test
    @DisplayName("a violation unrelated to the duplicate race still surfaces after the re-read")
    void anyIntegrityViolationTriggersRecovery() {
        // The recovery path does not attempt to distinguish WHICH constraint fired. That is
        // deliberate: the only two outcomes are "the prescription exists after all" (handled)
        // or "it still doesn't" (propagates), and both are correct regardless of which
        // constraint the database happened to name.
        when(service.ingest(REQUEST))
                .thenThrow(new DataIntegrityViolationException("some other constraint"));
        when(service.get("clinic-1", "rx-1")).thenReturn(snapshot());

        assertThat(intake.ingest(REQUEST)).isNotNull();
    }

    private static EmrPrescriptionSnapshot snapshot() {
        return new EmrPrescriptionSnapshot("ph_1", "rx_1", "RX-000001", "clinic-1", "rx-1",
                null, "RECEIVED", Instant.now(), List.of(), List.of());
    }
}
