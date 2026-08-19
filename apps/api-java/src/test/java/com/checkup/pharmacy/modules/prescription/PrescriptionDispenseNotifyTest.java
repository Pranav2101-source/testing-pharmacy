package com.checkup.pharmacy.modules.prescription;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The dispense-notify state machine on the prescription itself.
 *
 * <p>The case worth the test is the out-of-order one. Deliveries run on a pool and a slow
 * attempt can outlive a fast one, so a failure can arrive after a success for the same
 * prescription. Without a guard it overwrites SENT with FAILED, the sweeper re-sends a
 * callback the clinic already has, and nothing anywhere reports a problem.
 */
class PrescriptionDispenseNotifyTest {

    private static Prescription emrPrescription() {
        return Prescription.createFromEmr("ph-1", "RX-1", "tenant-9", "ext-rx-1", "EMR-77",
                "Dr Who", null, null, "A Patient", 40, null, null, null, null, null);
    }

    @Test
    @DisplayName("a sale queues the callback with a full budget of attempts")
    void pendingResetsTheBudget() {
        Prescription rx = emrPrescription();
        rx.markDispenseNotifyFailed("earlier trouble", Instant.now(), Instant.now());

        rx.markDispenseNotifyPending();

        assertThat(rx.getDispenseNotifyStatus()).isEqualTo(Prescription.NOTIFY_PENDING);
        assertThat(rx.getDispenseNotifyAttempts())
                .as("a new sale is a new fact to report, not a retry of the old one")
                .isZero();
        assertThat(rx.getDispenseNotifyError()).isNull();
        assertThat(rx.getDispenseNotifyNextAttemptAt())
                .as("due immediately — the sweeper's predicate is one comparison, never a NULL case")
                .isNotNull();
    }

    @Test
    @DisplayName("a delivery clears the schedule so the sweeper stops looking at it")
    void sentClearsTheSchedule() {
        Prescription rx = emrPrescription();
        rx.markDispenseNotifyPending();

        rx.markDispenseNotifySent();

        assertThat(rx.getDispenseNotifyStatus()).isEqualTo(Prescription.NOTIFY_SENT);
        assertThat(rx.getDispenseNotifiedAt()).isNotNull();
        assertThat(rx.getDispenseNotifyNextAttemptAt())
                .as("nothing scheduled; NULL is what keeps it out of the backlog query")
                .isNull();
        assertThat(rx.getDispenseNotifyError()).isNull();
    }

    @Test
    @DisplayName("a failure counts an attempt and schedules the next one")
    void failureRecordsAndSchedules() {
        Prescription rx = emrPrescription();
        rx.markDispenseNotifyPending();
        Instant next = Instant.now().plusSeconds(60);

        rx.markDispenseNotifyFailed("The clinic's server refused the connection.", next, Instant.now());

        assertThat(rx.getDispenseNotifyStatus()).isEqualTo(Prescription.NOTIFY_FAILED);
        assertThat(rx.getDispenseNotifyAttempts()).isEqualTo(1);
        assertThat(rx.getDispenseNotifyError()).contains("refused");
        assertThat(rx.getDispenseNotifyNextAttemptAt()).isEqualTo(next);
    }

    @Test
    @DisplayName("giving up leaves FAILED with nothing scheduled")
    void givingUpSchedulesNothing() {
        Prescription rx = emrPrescription();
        rx.markDispenseNotifyPending();

        rx.markDispenseNotifyFailed("No EMR key has been issued.", null, Instant.now());

        assertThat(rx.getDispenseNotifyStatus()).isEqualTo(Prescription.NOTIFY_FAILED);
        assertThat(rx.getDispenseNotifyNextAttemptAt())
                .as("FAILED with nothing scheduled is what the Retry button is offered for")
                .isNull();
    }

    @Test
    @DisplayName("a late failure does NOT overwrite a delivery that already succeeded")
    void staleFailureIsIgnored() {
        // Attempt A starts and stalls. Attempt B starts later, succeeds, writes SENT.
        // A finally times out and reports failure — with a start time BEFORE the success.
        Prescription rx = emrPrescription();
        rx.markDispenseNotifyPending();
        Instant slowAttemptStartedAt = Instant.now().minusSeconds(30);

        rx.markDispenseNotifySent();
        rx.markDispenseNotifyFailed("The clinic's server was too slow.", Instant.now(), slowAttemptStartedAt);

        assertThat(rx.getDispenseNotifyStatus())
                .as("the success landed after this attempt began, so this attempt's opinion is stale")
                .isEqualTo(Prescription.NOTIFY_SENT);
        assertThat(rx.getDispenseNotifyError()).isNull();
        assertThat(rx.getDispenseNotifyNextAttemptAt())
                .as("re-scheduling here would re-send a callback the clinic already has")
                .isNull();
    }

    @Test
    @DisplayName("a failure that began AFTER the last success is still recorded")
    void freshFailureAfterSuccessIsRecorded() {
        // The guard must not swallow genuine failures: a later sale queues a new callback,
        // and if that one fails it has to be visible even though an earlier one succeeded.
        Prescription rx = emrPrescription();
        rx.markDispenseNotifySent();
        Instant laterAttempt = Instant.now().plusSeconds(1);

        rx.markDispenseNotifyFailed("The clinic's server refused.", Instant.now(), laterAttempt);

        assertThat(rx.getDispenseNotifyStatus()).isEqualTo(Prescription.NOTIFY_FAILED);
        assertThat(rx.getDispenseNotifyError()).contains("refused");
    }

    @Test
    @DisplayName("a manual retry clears the budget but does not schedule for right now")
    void requeueLeavesALease() {
        Prescription rx = emrPrescription();
        rx.markDispenseNotifyPending();
        rx.markDispenseNotifyFailed("gave up", null, Instant.now());

        Instant before = Instant.now();
        rx.requeueDispenseNotify();

        assertThat(rx.getDispenseNotifyStatus()).isEqualTo(Prescription.NOTIFY_PENDING);
        assertThat(rx.getDispenseNotifyAttempts())
                .as("someone asserted the situation changed, so the old backoff is stale evidence")
                .isZero();
        assertThat(rx.getDispenseNotifyNextAttemptAt())
                .as("a short lease, not 'now' — dating it now invites a double send to a server "
                        + "that has usually just come back up")
                .isAfter(before);
    }

    @Test
    @DisplayName("a counter-written prescription has nowhere to report back to")
    void counterWrittenIsNotFromEmr() {
        Prescription counter = Prescription.create("ph-1", "RX-2", null, "Dr Local", null, null,
                "A Patient", 30, null, null, null, null, null, null);

        assertThat(counter.isFromEmr()).isFalse();
        assertThat(emrPrescription().isFromEmr()).isTrue();
    }
}
