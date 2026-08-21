package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Makes ingestion idempotent under concurrency, for every surface that ingests.
 *
 * <h2>The race this closes</h2>
 * {@link EmrIntegrationService#ingest} checks whether a prescription already exists and then
 * inserts it. Those are two steps, and a clinic that pushes the same prescription twice at
 * once — a retry firing while the first attempt is still in flight, which is precisely what
 * a retrying client does — puts both requests past the check before either inserts. The
 * unique index then does its job and rejects the loser.
 *
 * <p>The intent was already idempotent: a duplicate push is supposed to return the existing
 * prescription. Without this, the loser instead gets a 500, the clinic marks the push failed,
 * and it retries — arriving at a state where the pharmacy holds the prescription and the
 * clinic believes it does not. The database was right; the response was wrong.
 *
 * <h2>Why this cannot live inside the service</h2>
 * Two reasons, and both are structural rather than stylistic:
 * <ul>
 *   <li>JPA defers the INSERT to flush, so the violation surfaces <b>at commit</b> — after
 *       the service method's own body has returned. There is no point inside it at which the
 *       failure could be caught.</li>
 *   <li>Once a transaction has failed a constraint it is rollback-only, so the recovering
 *       read has to happen in a <b>new</b> transaction. That means a separate bean: a
 *       self-call would bypass the proxy and reuse the poisoned one.</li>
 * </ul>
 * This class therefore owns no transaction of its own. Adding {@code @Transactional} here
 * would re-create exactly the problem it exists to solve.
 *
 * <p>Note this is not a job for {@code @RetryOnConflict}: that retries transient write races
 * and deliberately lets constraint violations propagate on the first attempt. It is right to
 * do so — a constraint violation is usually a bug. This one is not, and the distinction is
 * that here the losing request's work is <em>already done</em>, by the winner.
 */
@Service
public class EmrPrescriptionIntake {

    private static final Logger log = LoggerFactory.getLogger(EmrPrescriptionIntake.class);

    private final EmrIntegrationService integrationService;

    public EmrPrescriptionIntake(EmrIntegrationService integrationService) {
        this.integrationService = integrationService;
    }

    /**
     * Ingests a prescription, treating a concurrent duplicate as the success it is.
     *
     * @return the stored prescription, whether this call created it or lost the race to a
     *         caller that did.
     */
    public EmrPrescriptionSnapshot ingest(EmrPrescriptionIngestRequest request) {
        try {
            return integrationService.ingest(request);
        } catch (DataIntegrityViolationException e) {
            // Someone inserted this prescription between our existence check and our commit.
            // That is the outcome this endpoint promises, reached by a different route, so
            // read back what they wrote and answer normally.
            //
            // If the re-read ALSO fails, the exception propagates: at that point the
            // violation was not the duplicate-prescription race and must not be swallowed.
            log.info("Concurrent duplicate ingest for prescription {} of tenant {} — returning the stored one",
                    request.externalPrescriptionId(), request.externalTenantId());
            return integrationService.get(request.externalTenantId(), request.externalPrescriptionId());
        }
    }
}
