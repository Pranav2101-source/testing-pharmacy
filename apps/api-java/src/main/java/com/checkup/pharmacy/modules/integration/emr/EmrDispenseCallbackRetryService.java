package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionItem;
import com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.tenant.SystemContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * Finds callbacks owed to clinics and tries them again.
 *
 * <p>Rebuilds the delivery event from the database rather than keeping the original in
 * memory. That is what makes the sweep correct after a restart — the event that would have
 * been retained died with the process — and it is also what keeps redelivery honest:
 * quantities are read fresh, so a prescription billed twice between attempts reports the
 * new cumulative total rather than the stale one.
 */
@Service
public class EmrDispenseCallbackRetryService {

    private static final Logger log = LoggerFactory.getLogger(EmrDispenseCallbackRetryService.class);

    /**
     * Ceiling on one sweep. Bounded because each delivery is an HTTP call with an 8-second
     * read timeout: an unbounded batch after a long outage would run for hours holding the
     * scheduler lock. Whatever is left is picked up on the next tick two minutes later.
     */
    private static final int BATCH_SIZE = 25;

    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository itemRepository;
    private final EmrDispenseCallbackService callbackService;

    public EmrDispenseCallbackRetryService(PrescriptionRepository prescriptionRepository,
                                           PrescriptionItemRepository itemRepository,
                                           EmrDispenseCallbackService callbackService) {
        this.prescriptionRepository = prescriptionRepository;
        this.itemRepository = itemRepository;
        this.callbackService = callbackService;
    }

    /** @return how many deliveries the clinic accepted this sweep. */
    public int sweep() {
        List<Prescription> due = SystemContext.callAsSystem(() ->
                prescriptionRepository.findDispenseCallbackBacklog(
                        Instant.now(), EmrDispenseRetryPolicy.MAX_ATTEMPTS,
                        PageRequest.of(0, BATCH_SIZE)));

        int delivered = 0;
        for (Prescription rx : due) {
            try {
                PrescriptionDispensedEvent event = SystemContext.callAsSystem(() -> buildEvent(rx));
                if (event == null) {
                    continue;
                }
                if (callbackService.deliver(event)) {
                    delivered++;
                }
            } catch (RuntimeException e) {
                // One bad row must not abandon the rest of the batch. deliver() records its own
                // failures, so anything surfacing here is unexpected — most likely a row whose
                // data cannot be turned into an event at all.
                log.error("Dispense callback retry failed for prescription {}", rx.getId(), e);
            }
        }
        return delivered;
    }

    /**
     * Reconstructs the delivery event from current state.
     *
     * <p>Returns null for a prescription that can no longer be reported — one that is not
     * from an EMR at all. Callers skip those rather than treating them as failures: there is
     * nothing to deliver and nobody to tell.
     */
    @Transactional(readOnly = true)
    protected PrescriptionDispensedEvent buildEvent(Prescription rx) {
        if (!rx.isFromEmr()) {
            return null;
        }
        List<PrescriptionItem> items = itemRepository.findByPrescriptionId(rx.getId());

        boolean fullyDispensed = !items.isEmpty()
                && items.stream().allMatch(PrescriptionItem::isFullyDispensed);

        List<PrescriptionDispensedEvent.DispensedItem> payloadItems = items.stream()
                .map(i -> new PrescriptionDispensedEvent.DispensedItem(
                        i.getExternalEmrItemId(),
                        i.getMedicineName(),
                        i.getDispensedMedicineName() != null ? i.getDispensedMedicineName() : i.getMedicineName(),
                        i.getDispensedQty(),
                        i.getQuantity(),
                        i.isSubstituted()))
                .toList();

        // No invoice number on a retry: the sweep reports the prescription's cumulative
        // position, which may span several sales, and naming one of them would be arbitrary
        // and misleading. The original delivery carried it; this one is a correction.
        return new PrescriptionDispensedEvent(
                rx.getPharmacyId(),
                rx.getId(),
                rx.getPrescriptionNumber(),
                rx.getExternalEmrTenantId(),
                rx.getExternalEmrPrescriptionId(),
                null,
                Instant.now(),
                fullyDispensed,
                payloadItems);
    }
}
