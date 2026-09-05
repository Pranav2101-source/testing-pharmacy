package com.checkup.pharmacy.modules.medicine;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.concurrent.RejectedExecutionException;

/**
 * Hands a confirmed GRN's local medicines to the background matcher, off the
 * confirm request's thread — mirrors {@code EmrDispenseCallbackListener} exactly.
 *
 * <p>AFTER_COMMIT, not on the GRN's own transaction: a match attempt for a GRN
 * confirm that then rolled back would try to link rows that no longer matter, and
 * running inside the transaction would hold a connection open for no reason (this
 * work is never urgent — see {@link GrnMedicineMatchConfig}).
 */
@Component
public class GrnMedicineMatchListener {

    private static final Logger log = LoggerFactory.getLogger(GrnMedicineMatchListener.class);

    private final GrnMedicineMatchService matchService;

    public GrnMedicineMatchListener(GrnMedicineMatchService matchService) {
        this.matchService = matchService;
    }

    @Async(GrnMedicineMatchConfig.EXECUTOR)
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onGrnConfirmed(GrnConfirmedEvent event) {
        if (event.localMedicineIds().isEmpty()) {
            return;
        }
        try {
            matchService.matchIds(event.pharmacyId(), event.localMedicineIds());
        } catch (RejectedExecutionException e) {
            // Left PENDING — the scheduled backstop sweep recovers it; see
            // GrnMedicineMatchConfig's javadoc for why ABORT is the right policy here.
            log.warn("GRN medicine match rejected (pool saturated) for GRN {} — left pending", event.grnId());
        } catch (RuntimeException e) {
            // This is a background thread; an exception thrown from one is only ever
            // noise in a log, and must not escape.
            log.error("GRN medicine match threw unexpectedly for GRN {}", event.grnId(), e);
        }
    }
}
