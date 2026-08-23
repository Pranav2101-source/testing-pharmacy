package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.integration.emr.dto.EmrCancelPayload;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.HmacSigner;
import com.checkup.pharmacy.security.LegacyWebhookSigner;
import com.checkup.pharmacy.tenant.SystemContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.time.Instant;

/**
 * Delivers "this prescription no longer stands" to the clinic that wrote it — the mirror of
 * {@link EmrDispenseCallbackService}, and built to the same three constraints (never blocks
 * the cancellation itself, failure is visible and retryable, safe to send twice — sending a
 * cancellation notice again says nothing new the first one didn't).
 *
 * <p>Deliberately reuses {@link EmrDispenseCallbackService#resolveConnection} rather than a
 * second copy of the dialect/secret logic: which secret a pharmacy holds, and therefore
 * which envelope its clinic expects, is a fact about the pharmacy's connection, not about
 * what is being reported. Two independent copies of that resolution are two places for the
 * two to quietly drift apart.
 */
@Service
public class EmrCancelCallbackService {

    private static final Logger log = LoggerFactory.getLogger(EmrCancelCallbackService.class);

    /** Matches the column width — see the migration for prescriptions.cancelNotifyError. */
    private static final int MAX_ERROR_LENGTH = 300;

    private final PrescriptionRepository prescriptionRepository;
    private final EmrDispenseCallbackService connectionResolver;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    public EmrCancelCallbackService(PrescriptionRepository prescriptionRepository,
                                    EmrDispenseCallbackService connectionResolver,
                                    ObjectMapper objectMapper) {
        this.prescriptionRepository = prescriptionRepository;
        this.connectionResolver = connectionResolver;
        this.objectMapper = objectMapper;
        // The SAME configured client the dispense callback uses — see
        // EmrDispenseCallbackService.restClient()'s javadoc for why building a second one
        // from Spring's default RestClient.Builder would be wrong, not just redundant.
        this.restClient = connectionResolver.restClient();
    }

    /**
     * Attempts one delivery and records the outcome. {@code REQUIRES_NEW} for the same reason
     * as the dispense callback: the caller's transaction (the cancellation itself) is already
     * committed by the time this runs on its own background thread.
     *
     * @return true when the clinic accepted it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean deliver(PrescriptionCancelledEvent event) {
        Instant attemptStartedAt = Instant.now();

        EmrDispenseCallbackService.Connection connection =
                SystemContext.callAsSystem(() -> connectionResolver.resolveConnection(event.pharmacyId()));
        if (connection == null || connection.secret() == null) {
            EmrDispenseFailureReason reason = connection != null && connection.decryptionFailed()
                    ? EmrDispenseFailureReason.decryptionFailed()
                    : EmrDispenseFailureReason.noSecret();
            recordFailure(event, reason, attemptStartedAt);
            return false;
        }
        String target = connection.callbackUrl();
        if (target.isEmpty()) {
            recordFailure(event, EmrDispenseFailureReason.notConfigured(), attemptStartedAt);
            return false;
        }
        String secret = connection.secret();

        try {
            byte[] body = objectMapper.writeValueAsBytes(EmrCancelPayload.from(event));
            String timestamp = String.valueOf(Instant.now().getEpochSecond());
            String path = URI.create(target).getPath();

            var request = restClient.post()
                    .uri(target)
                    .contentType(MediaType.APPLICATION_JSON);

            if (connection.dialect() == EmrDispenseCallbackService.Connection.Dialect.LEGACY_WEBHOOK) {
                request = request.header(LegacyWebhookSigner.HEADER,
                        LegacyWebhookSigner.header(secret, new String(body, java.nio.charset.StandardCharsets.UTF_8)));
            } else {
                request = request
                        .header(EmrDispenseCallbackService.HEADER_PHARMACY, event.pharmacyId())
                        .header(EmrDispenseCallbackService.HEADER_TIMESTAMP, timestamp)
                        .header(EmrDispenseCallbackService.HEADER_SIGNATURE,
                                HmacSigner.sign(secret, timestamp, "POST", path, event.pharmacyId(), body));
            }

            request.body(body).retrieve().toBodilessEntity();

            recordSent(event);
            log.info("Cancellation callback delivered for prescription {} (tenant {})",
                    event.prescriptionNumber(), event.externalTenantId());
            return true;
        } catch (Exception e) {
            recordFailure(event, EmrDispenseFailureReason.of(e), attemptStartedAt);
            log.warn("Cancellation callback failed for prescription {} (tenant {}): {}",
                    event.prescriptionNumber(), event.externalTenantId(), e.toString());
            return false;
        }
    }

    private void recordSent(PrescriptionCancelledEvent event) {
        SystemContext.runAsSystem(() ->
                prescriptionRepository.findByIdAndPharmacyId(event.prescriptionId(), event.pharmacyId())
                        .ifPresent(rx -> {
                    rx.markCancelNotifySent();
                    prescriptionRepository.save(rx);
                }));
    }

    private void recordFailure(PrescriptionCancelledEvent event,
                               EmrDispenseFailureReason reason,
                               Instant attemptStartedAt) {
        SystemContext.runAsSystem(() ->
                prescriptionRepository.findByIdAndPharmacyId(event.prescriptionId(), event.pharmacyId())
                        .ifPresent(rx -> {
                    Instant nextAttempt = reason.retryable()
                            ? EmrDispenseRetryPolicy
                                    .nextAttemptAfter(rx.getCancelNotifyAttempts() + 1, Instant.now())
                                    .orElse(null)
                            : null;
                    rx.markCancelNotifyFailed(truncate(reason.message()), nextAttempt, attemptStartedAt);
                    prescriptionRepository.save(rx);
                }));
    }

    private static String truncate(String message) {
        if (message == null) {
            return null;
        }
        return message.length() <= MAX_ERROR_LENGTH ? message : message.substring(0, MAX_ERROR_LENGTH);
    }

    /**
     * Puts a given-up callback back in the sweeper's queue. Mirrors
     * {@link EmrDispenseCallbackService#requeue} — see there for why this queues rather than
     * delivering inline, and why it is deliberately not wrapped around a delivery.
     */
    @Transactional
    public boolean requeue(String prescriptionId, String pharmacyId) {
        Prescription rx = prescriptionRepository
                .findByIdAndPharmacyId(prescriptionId, pharmacyId).orElse(null);
        if (rx == null || !rx.isFromEmr()) {
            return false;
        }
        rx.requeueCancelNotify();
        prescriptionRepository.save(rx);
        return true;
    }
}
