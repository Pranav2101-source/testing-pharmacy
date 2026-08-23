package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.tenant.SystemContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

/**
 * Finds cancellation callbacks owed to clinics and tries them again. Mirrors
 * {@link EmrDispenseCallbackRetryService} — see there for why the event is rebuilt from the
 * database each sweep rather than kept in memory.
 */
@Service
public class EmrCancelCallbackRetryService {

    private static final Logger log = LoggerFactory.getLogger(EmrCancelCallbackRetryService.class);

    /** Same ceiling as the dispense sweep, and for the same reason — see that class. */
    private static final int BATCH_SIZE = 25;

    private final PrescriptionRepository prescriptionRepository;
    private final EmrCancelCallbackService callbackService;

    public EmrCancelCallbackRetryService(PrescriptionRepository prescriptionRepository,
                                         EmrCancelCallbackService callbackService) {
        this.prescriptionRepository = prescriptionRepository;
        this.callbackService = callbackService;
    }

    /** @return how many deliveries the clinic accepted this sweep. */
    public int sweep() {
        List<Prescription> due = SystemContext.callAsSystem(() ->
                prescriptionRepository.findCancelCallbackBacklog(
                        Instant.now(), EmrDispenseRetryPolicy.MAX_ATTEMPTS,
                        PageRequest.of(0, BATCH_SIZE)));

        int delivered = 0;
        for (Prescription rx : due) {
            try {
                if (!rx.isFromEmr()) {
                    continue;
                }
                PrescriptionCancelledEvent event = new PrescriptionCancelledEvent(
                        rx.getPharmacyId(), rx.getId(), rx.getPrescriptionNumber(),
                        rx.getExternalEmrTenantId(), rx.getExternalEmrPrescriptionId(), Instant.now());
                if (callbackService.deliver(event)) {
                    delivered++;
                }
            } catch (RuntimeException e) {
                log.error("Cancellation callback retry failed for prescription {}", rx.getId(), e);
            }
        }
        return delivered;
    }
}
