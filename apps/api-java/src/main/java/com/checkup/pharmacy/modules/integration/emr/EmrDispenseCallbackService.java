package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.integration.emr.dto.EmrDispensePayload;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.EmrSecretCipher;
import com.checkup.pharmacy.security.HmacSigner;
import com.checkup.pharmacy.tenant.SystemContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * Delivers "this is what was actually dispensed" to the clinic that wrote the prescription.
 *
 * <p>The return leg of the EMR integration, and the direction that closes the loop: a chart
 * saying a drug was prescribed, without saying whether the patient ever collected it, is
 * missing the half a clinician acts on.
 *
 * <h2>Three constraints this class is built around</h2>
 * <ol>
 *   <li><b>A sale must never fail because an EMR is unreachable.</b> This runs after the sale
 *       has committed, on another thread, and every failure path ends in a recorded status
 *       rather than an exception reaching billing.</li>
 *   <li><b>Failure must be visible, and then acted on.</b> Silently dropping a callback
 *       leaves a clinic with a chart that quietly disagrees with reality. Every attempt
 *       writes SENT or FAILED with a reason and a time to try again, which the sweeper works
 *       off unattended. Visible was never the goal on its own — a status nobody reads back is
 *       the same outage with better paperwork.</li>
 *   <li><b>It must be safe to send twice.</b> Quantities are cumulative totals, not
 *       increments, so a retry that duplicates a delivery sets the same numbers again instead
 *       of doubling them. That is what lets the recovery path stay simple.</li>
 * </ol>
 *
 * <h2>Why SystemContext</h2>
 * This runs on a pool thread with no {@code SecurityContext}, so {@code TenantContext} is
 * empty and RLS — which fails closed — would reject every query. The tenant travels on the
 * event instead, and the reads are elevated deliberately and narrowly.
 */
@Service
public class EmrDispenseCallbackService {

    private static final Logger log = LoggerFactory.getLogger(EmrDispenseCallbackService.class);

    /** Matches the column width; a stack trace in a UI field helps nobody. */
    private static final int MAX_ERROR_LENGTH = 300;

    private final PrescriptionRepository prescriptionRepository;
    private final PharmacyRepository pharmacyRepository;
    private final EmrSecretCipher secretCipher;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;
    private final String callbackUrl;

    public EmrDispenseCallbackService(PrescriptionRepository prescriptionRepository,
                                      PharmacyRepository pharmacyRepository,
                                      EmrSecretCipher secretCipher,
                                      ObjectMapper objectMapper,
                                      @Value("${app.integration.emr.callback-url:}") String callbackUrl,
                                      @Value("${app.integration.emr.connect-timeout-ms:3000}")
                                      int connectTimeoutMs,
                                      @Value("${app.integration.emr.read-timeout-ms:8000}")
                                      int readTimeoutMs) {
        this.prescriptionRepository = prescriptionRepository;
        this.pharmacyRepository = pharmacyRepository;
        this.secretCipher = secretCipher;
        this.objectMapper = objectMapper;
        this.callbackUrl = callbackUrl == null ? "" : callbackUrl.trim();

        // Timeouts are not optional here. Without them an EMR that accepts a connection and
        // then goes silent holds a pool thread forever, and a handful of those take the whole
        // callback pipeline down — for every other pharmacy too.
        //
        // The JDK HttpClient rather than SimpleClientHttpRequestFactory: the latter is
        // HttpURLConnection underneath and opens a fresh connection per call, so every
        // callback pays a full TCP plus TLS handshake to a host it just spoke to. Invisible on
        // one sale; not invisible on a sweep of 25 deliveries to the same host in one tick.
        //
        // Connect timeout lives on the client and read timeout on the factory — the JDK splits
        // them that way, and setting only one is how a hung server still holds a thread for as
        // long as it likes.
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                // Redirects are NOT followed on purpose: the signature covers the body, not the
                // destination, so following one would hand a signed dispensing record to a host
                // nobody configured.
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        this.restClient = RestClient.builder().requestFactory(factory).build();
    }

    /**
     * Attempts one delivery and records the outcome.
     *
     * <p>{@code REQUIRES_NEW} because the caller's transaction is already gone by the time
     * this runs — this owns its own unit of work, and the status write must survive
     * independently of anything else.
     *
     * @return true when the clinic accepted it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean deliver(PrescriptionDispensedEvent event) {
        // Stamped before anything is attempted, and carried into every failure path. It is
        // what lets a late-arriving failure recognise that some other delivery succeeded
        // meanwhile — see Prescription.markDispenseNotifyFailed.
        Instant attemptStartedAt = Instant.now();

        Connection connection = SystemContext.callAsSystem(() -> resolveConnection(event.pharmacyId()));
        if (connection == null || connection.secret() == null) {
            recordFailure(event, EmrDispenseFailureReason.noSecret(), attemptStartedAt);
            return false;
        }
        String target = connection.callbackUrl();
        if (target.isEmpty()) {
            recordFailure(event, EmrDispenseFailureReason.notConfigured(), attemptStartedAt);
            return false;
        }
        String secret = connection.secret();

        try {
            byte[] body = objectMapper.writeValueAsBytes(EmrDispensePayload.from(event));
            String timestamp = String.valueOf(Instant.now().getEpochSecond());
            String path = URI.create(target).getPath();

            restClient.post()
                    .uri(target)
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(HEADER_PHARMACY, event.pharmacyId())
                    .header(HEADER_TIMESTAMP, timestamp)
                    // Signed over the exact bytes sent, using the same canonical form the
                    // inbound filter verifies. One scheme in both directions means one thing to
                    // get right, and one thing to rotate.
                    .header(HEADER_SIGNATURE,
                            HmacSigner.sign(secret, timestamp, "POST", path, event.pharmacyId(), body))
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();

            recordSent(event);
            log.info("Dispense callback delivered for prescription {} (tenant {})",
                    event.prescriptionNumber(), event.externalTenantId());
            return true;
        } catch (Exception e) {
            // Catches transport failures AND non-2xx responses, which RestClient raises as
            // exceptions. Both mean the clinic does not have the update.
            recordFailure(event, EmrDispenseFailureReason.of(e), attemptStartedAt);

            // The classified sentence goes on the prescription for a pharmacist; the raw
            // exception goes here, for whoever ends up debugging it. Neither substitutes for
            // the other, which is why both exist.
            log.warn("Dispense callback failed for prescription {} (tenant {}): {}",
                    event.prescriptionNumber(), event.externalTenantId(), e.toString());
            return false;
        }
    }

    /** Matches the inbound filter's headers, so one scheme covers both directions. */
    static final String HEADER_PHARMACY = "X-Pharmacy-Id";
    static final String HEADER_TIMESTAMP = "X-Checkup-Timestamp";
    static final String HEADER_SIGNATURE = "X-Checkup-Signature";

    /** What one delivery needs: who to call, and what to sign it with. */
    record Connection(String secret, String callbackUrl) {
    }

    /**
     * The pharmacy's decrypted EMR secret and the clinic address it belongs to, or null
     * when the pharmacy has no usable secret.
     *
     * <p>Mirrors {@code EmrHmacAuthenticationFilter.resolveSecret} deliberately: the outbound
     * direction must be gated on exactly the same conditions as the inbound one. Holding a
     * secret is the whole permission on both sides — a pharmacy that disconnected its clinic
     * has none, and stops sending as well as receiving.
     *
     * <p>The address is the one the pharmacy entered for its clinic. The app-level property
     * remains as a fallback for pharmacies connected before that field existed; it is the
     * wrong shape for more than one clinic, because the clinic's own connection id is part
     * of the path.
     */
    private Connection resolveConnection(String pharmacyId) {
        Optional<Pharmacy> pharmacy = pharmacyRepository.findById(pharmacyId);
        if (pharmacy.isEmpty() || !pharmacy.get().isActive()) {
            return null;
        }
        Pharmacy p = pharmacy.get();
        String target = p.getEmrCallbackUrl() == null || p.getEmrCallbackUrl().isBlank()
                ? callbackUrl
                : p.getEmrCallbackUrl().trim();
        if (p.getEmrSecretCiphertext() == null || p.getEmrSecretIv() == null || p.getEmrSecretTag() == null) {
            return new Connection(null, target);
        }
        try {
            return new Connection(
                    secretCipher.decrypt(p.getEmrSecretCiphertext(), p.getEmrSecretIv(), p.getEmrSecretTag()),
                    target);
        } catch (Exception e) {
            log.error("EMR secret for pharmacy {} could not be decrypted", pharmacyId, e);
            return new Connection(null, target);
        }
    }

    private void recordSent(PrescriptionDispensedEvent event) {
        SystemContext.runAsSystem(() ->
                prescriptionRepository.findByIdAndPharmacyId(event.prescriptionId(), event.pharmacyId())
                        .ifPresent(rx -> {
                    rx.markDispenseNotifySent();
                    prescriptionRepository.save(rx);
                }));
    }

    /**
     * Writes the failure, and schedules the next attempt when one is worth making.
     *
     * <p>A non-retryable reason gets no next attempt: nothing about trying the same request
     * again would change a 401 or an unconfigured URL, and a queue full of those hides the
     * failures somebody could still act on.
     */
    private void recordFailure(PrescriptionDispensedEvent event,
                               EmrDispenseFailureReason reason,
                               Instant attemptStartedAt) {
        SystemContext.runAsSystem(() ->
                prescriptionRepository.findByIdAndPharmacyId(event.prescriptionId(), event.pharmacyId())
                        .ifPresent(rx -> {
                    Instant nextAttempt = reason.retryable()
                            ? EmrDispenseRetryPolicy
                                    .nextAttemptAfter(rx.getDispenseNotifyAttempts() + 1, Instant.now())
                                    .orElse(null)
                            : null;
                    rx.markDispenseNotifyFailed(truncate(reason.message()), nextAttempt, attemptStartedAt);
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
     * Puts a callback the automatic retries gave up on back in the sweeper's queue, for a
     * pharmacist who has established the clinic is reachable again.
     *
     * <p>This queues rather than delivers: the next sweep picks it up within a minute. That
     * is deliberate — delivering inline would mean rebuilding the event from the database on
     * a request thread and holding the pharmacist's click open for the length of an HTTP call
     * to someone else's server, which is the coupling the whole design avoids.
     *
     * <p>Deliberately NOT {@code @Transactional} around a delivery for the same reason: a
     * requeue and a delivery in one transaction would let the outer commit land last and
     * overwrite the delivery's result with the stale pending state it started from.
     */
    @Transactional
    public boolean requeue(String prescriptionId, String pharmacyId) {
        // Scoped by pharmacy rather than by id alone: this is reachable from a request, so the
        // id arrives from a caller and must not be trusted to belong to this tenant.
        Prescription rx = prescriptionRepository
                .findByIdAndPharmacyId(prescriptionId, pharmacyId).orElse(null);
        if (rx == null || !rx.isFromEmr()) {
            return false;
        }
        rx.requeueDispenseNotify();
        prescriptionRepository.save(rx);
        return true;
    }
}
