package com.checkup.pharmacy.modules.integration.emr;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.concurrent.RejectedExecutionException;

/**
 * Hands a committed sale's dispense event to the delivery, off the billing thread.
 *
 * <p>AFTER_COMMIT, not on the sale's transaction. A callback for a sale that then rolled
 * back would tell a clinic a patient collected medicine they did not; and running inside
 * the transaction would hold a database connection open for the length of an HTTP call to
 * someone else's server.
 */
@Component
public class EmrDispenseCallbackListener {

    private static final Logger log = LoggerFactory.getLogger(EmrDispenseCallbackListener.class);

    private final EmrDispenseCallbackService callbackService;

    public EmrDispenseCallbackListener(EmrDispenseCallbackService callbackService) {
        this.callbackService = callbackService;
    }

    @Async(EmrDispenseCallbackConfig.EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPrescriptionDispensed(PrescriptionDispensedEvent event) {
        try {
            callbackService.deliver(event);
        } catch (RejectedExecutionException e) {
            // The pool is saturated — every clinic is slow at once, or one is and the queue
            // filled. The prescription is still PENDING, so this is a delay rather than a
            // loss, and refusing the work is the correct outcome: the alternative policy
            // would push it onto the thread that just billed a customer.
            log.warn("Dispense callback rejected (pool saturated) for prescription {} — left pending",
                    event.prescriptionNumber());
        } catch (RuntimeException e) {
            // deliver() records its own failures; anything reaching here is unexpected. It
            // must still not escape — this is a background thread, and an exception thrown
            // from one is only ever noise in a log.
            log.error("Dispense callback threw unexpectedly for prescription {}",
                    event.prescriptionNumber(), e);
        }
    }
}
