package com.checkup.pharmacy.security;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.HexFormat;

/**
 * The clinic's webhook signature scheme, for pharmacies paired through the compatibility
 * surface (see {@link EmrApiKeyAuthenticationFilter}, {@code ClinicPairingService}).
 *
 * <h2>Why this is not just {@link HmacSigner} again</h2>
 * It signs different material in a different envelope, and the clinic's receiver checks it
 * byte for byte:
 * <ul>
 *   <li>Header is {@code X-Pharmacy-Signature: t=<epochSeconds>,v1=<hex>}, not
 *       {@code X-Checkup-Signature: sha256=<hex>}.</li>
 *   <li>Signed material is {@code "<timestamp>.<rawBody>"} — a literal dot-joined string —
 *       not this product's newline-delimited canonical form that also binds the method,
 *       path and pharmacy id.</li>
 * </ul>
 * Producing {@code HmacSigner}'s form here would verify locally and fail on the clinic's
 * side, which is exactly the kind of drift a dialect-specific signer exists to prevent:
 * one class, one place, that has to match the other product's contract.
 *
 * <p>Preferred pharmacies never reach this class. It exists only for the callback leg of a
 * pairing established through {@code ClinicPairingService} — see
 * {@code Pharmacy#usesClinicCallbackDialect()}, which is what selects it.
 */
public final class LegacyWebhookSigner {

    public static final String HEADER = "X-Pharmacy-Signature";

    private static final String ALGORITHM = "HmacSHA256";

    private LegacyWebhookSigner() {
    }

    /** Builds the full {@code X-Pharmacy-Signature} header value for the given body, stamped now. */
    public static String header(String secret, String rawBody) {
        return header(secret, rawBody, String.valueOf(Instant.now().getEpochSecond()));
    }

    /**
     * The same header, at a caller-supplied timestamp.
     *
     * <p>Split out from {@link #header(String, String)} so the signing itself is pure and
     * testable against a known-answer vector — the only way to check this matches another
     * repository's algorithm without a live call to it. Production code should call the
     * single-argument overload; this one exists for that determinism.
     */
    public static String header(String secret, String rawBody, String timestamp) {
        return "t=" + timestamp + ",v1=" + hex(secret, timestamp + "." + rawBody);
    }

    private static String hex(String secret, String payload) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("Clinic webhook secret is not configured");
        }
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", e);
        }
    }
}
