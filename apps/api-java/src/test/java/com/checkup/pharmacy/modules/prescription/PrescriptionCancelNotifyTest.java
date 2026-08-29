package com.checkup.pharmacy.modules.prescription;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The cancel-notify state machine on the prescription itself — the exact mirror of
 * {@link PrescriptionDispenseNotifyTest}, same guarantees, opposite fact. Kept as a
 * parallel file rather than folded into that one so each stays readable as "the state
 * machine for X", and because the two will drift independently if either callback's rules
 * ever need to diverge.
 */
class PrescriptionCancelNotifyTest {

    private static Prescription emrPrescription() {
        return Prescription.createFromEmr("ph-1", "RX-1", "tenant-9", "ext-rx-1", "EMR-77", null,
                "Dr Who", null, null, "A Patient", 40, null, null, null, null, null);
    }

    @Test
    @DisplayName("a cancellation queues the callback with a full budget of attempts")
    void pendingResetsTheBudget() {
        Prescription rx = emrPrescription();
        rx.markCancelNotifyFailed("earlier trouble", Instant.now(), Instant.now());

        rx.markCancelNotifyPending();

        assertThat(rx.getCancelNotifyStatus()).isEqualTo(Prescription.NOTIFY_PENDING);
        assertThat(rx.getCancelNotifyAttempts()).isZero();
        assertThat(rx.getCancelNotifyError()).isNull();
        assertThat(rx.getCancelNotifyNextAttemptAt()).isNotNull();
    }

    @Test
    @DisplayName("a delivery clears the schedule so the sweeper stops looking at it")
    void sentClearsTheSchedule() {
        Prescription rx = emrPrescription();
        rx.markCancelNotifyPending();

        rx.markCancelNotifySent();

        assertThat(rx.getCancelNotifyStatus()).isEqualTo(Prescription.NOTIFY_SENT);
        assertThat(rx.getCancelNotifiedAt()).isNotNull();
        assertThat(rx.getCancelNotifyNextAttemptAt()).isNull();
        assertThat(rx.getCancelNotifyError()).isNull();
    }

    @Test
    @DisplayName("a failure counts an attempt and schedules the next one")
    void failureRecordsAndSchedules() {
        Prescription rx = emrPrescription();
        rx.markCancelNotifyPending();
        Instant next = Instant.now().plusSeconds(60);

        rx.markCancelNotifyFailed("The clinic's server refused the connection.", next, Instant.now());

        assertThat(rx.getCancelNotifyStatus()).isEqualTo(Prescription.NOTIFY_FAILED);
        assertThat(rx.getCancelNotifyAttempts()).isEqualTo(1);
        assertThat(rx.getCancelNotifyError()).contains("refused");
        assertThat(rx.getCancelNotifyNextAttemptAt()).isEqualTo(next);
    }

    @Test
    @DisplayName("giving up leaves FAILED with nothing scheduled")
    void givingUpSchedulesNothing() {
        Prescription rx = emrPrescription();
        rx.markCancelNotifyPending();

        rx.markCancelNotifyFailed("No EMR key has been issued.", null, Instant.now());

        assertThat(rx.getCancelNotifyStatus()).isEqualTo(Prescription.NOTIFY_FAILED);
        assertThat(rx.getCancelNotifyNextAttemptAt()).isNull();
    }

    @Test
    @DisplayName("a late failure does NOT overwrite a delivery that already succeeded")
    void staleFailureIsIgnored() {
        Prescription rx = emrPrescription();
        rx.markCancelNotifyPending();
        Instant slowAttemptStartedAt = Instant.now().minusSeconds(30);

        rx.markCancelNotifySent();
        rx.markCancelNotifyFailed("The clinic's server was too slow.", Instant.now(), slowAttemptStartedAt);

        assertThat(rx.getCancelNotifyStatus()).isEqualTo(Prescription.NOTIFY_SENT);
        assertThat(rx.getCancelNotifyError()).isNull();
        assertThat(rx.getCancelNotifyNextAttemptAt()).isNull();
    }

    @Test
    @DisplayName("a manual retry clears the budget but does not schedule for right now")
    void requeueLeavesALease() {
        Prescription rx = emrPrescription();
        rx.markCancelNotifyPending();
        rx.markCancelNotifyFailed("gave up", null, Instant.now());

        Instant before = Instant.now();
        rx.requeueCancelNotify();

        assertThat(rx.getCancelNotifyStatus()).isEqualTo(Prescription.NOTIFY_PENDING);
        assertThat(rx.getCancelNotifyAttempts()).isZero();
        assertThat(rx.getCancelNotifyNextAttemptAt()).isAfter(before);
    }
}
