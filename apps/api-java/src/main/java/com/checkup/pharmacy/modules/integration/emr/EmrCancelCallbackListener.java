package com.checkup.pharmacy.modules.integration.emr;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.concurrent.RejectedExecutionException;

/**
 * Hands a committed cancellation to the delivery, off the request thread. Mirrors
 * {@link EmrDispenseCallbackListener} exactly, including sharing its bounded executor — a
 * cancellation callback is the same kind of low-volume, best-effort HTTP call to a clinic
 * as a dispense one, and does not need a pool of its own.
 */
@Component
public class EmrCancelCallbackListener {

    private static final Logger log = LoggerFactory.getLogger(EmrCancelCallbackListener.class);

    private final EmrCancelCallbackService callbackService;

    public EmrCancelCallbackListener(EmrCancelCallbackService callbackService) {
        this.callbackService = callbackService;
    }

    @Async(EmrDispenseCallbackConfig.EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPrescriptionCancelled(PrescriptionCancelledEvent event) {
        try {
            callbackService.deliver(event);
        } catch (RejectedExecutionException e) {
            log.warn("Cancellation callback rejected (pool saturated) for prescription {} — left pending",
                    event.prescriptionNumber());
        } catch (RuntimeException e) {
            log.error("Cancellation callback threw unexpectedly for prescription {}",
                    event.prescriptionNumber(), e);
        }
    }
}
