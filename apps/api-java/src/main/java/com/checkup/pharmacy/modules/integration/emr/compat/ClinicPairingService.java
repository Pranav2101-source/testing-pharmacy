package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicPairRequest;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicPairResponse;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.security.ApiSecretHasher;
import com.checkup.pharmacy.security.EmrSecretCipher;
import com.checkup.pharmacy.tenant.SystemContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Establishes a clinic ↔ pharmacy link in a single exchange.
 *
 * <h2>What this replaces</h2>
 * Without it, connecting is a two-sided manual handshake: the pharmacist generates a key,
 * reads 43 characters across to whoever runs the clinic, and separately types the clinic's
 * callback address into their own screen. Every step is a chance to transpose a character,
 * and the failure it produces — a signature mismatch hours later, on a background thread —
 * is the least debuggable failure in the system.
 *
 * <p>Pairing collapses it: the clinic presents the code and, in the same call, says where to
 * reach it and how to sign callbacks to it. Nothing is retyped and nothing has to be
 * explained to either operator.
 *
 * <h2>Why this runs without authentication</h2>
 * It cannot require a credential, because it is where credentials come from. It is not
 * unauthenticated in the sense that matters: <b>the pairing code is the proof</b>, checked
 * against the key the pharmacist generated, and no link is established without it. That is
 * the same standard the manual path already meets — whoever holds the generated key can act
 * as the clinic — so pairing adds a door, not an exposure.
 *
 * <h2>What runs as system</h2>
 * There is no tenant context yet: the request arrives before anyone knows which pharmacy it
 * concerns, and finding that out is the first thing this does. The lookup and the write are
 * elevated deliberately and narrowly, in the same position staff authentication occupies.
 */
@Service
public class ClinicPairingService {

    private static final Logger log = LoggerFactory.getLogger(ClinicPairingService.class);

    private static final SecureRandom RNG = new SecureRandom();

    /** Where a clinic receives dispensing updates. Fixed by the clinic's own routing. */
    static final String CLINIC_CALLBACK_PATH = "/api/v1/pharmacy/webhooks/dispense";

    private final PharmacyRepository pharmacyRepository;
    private final EmrSecretCipher secretCipher;
    private final AuditService auditService;

    public ClinicPairingService(PharmacyRepository pharmacyRepository,
                                EmrSecretCipher secretCipher,
                                AuditService auditService) {
        this.pharmacyRepository = pharmacyRepository;
        this.secretCipher = secretCipher;
        this.auditService = auditService;
    }

    @Transactional
    public ClinicPairResponse pair(ClinicPairRequest request) {
        if (!secretCipher.isConfigured()) {
            // Same fail-closed posture as the HMAC filter: without the at-rest key there is
            // nowhere safe to put the clinic's webhook secret, so refuse rather than store
            // somebody else's credential in the clear.
            throw new BadRequestException("Clinic pairing is not available on this server");
        }

        String code = request.code().trim();
        String callbackUrl = clinicCallbackUrl(request.emrBaseUrl());

        Pharmacy pharmacy = SystemContext.callAsSystem(() -> findByPairingCode(code));
        if (pharmacy == null) {
            // One message for "no pharmacy has generated a code", "the code is wrong" and
            // "the pharmacy is inactive". Distinguishing them would let a caller probe for
            // valid codes by watching which answer comes back.
            log.warn("Clinic pairing rejected: no active pharmacy matches the presented code");
            throw new BadRequestException("That pairing code is not valid. Ask the pharmacy to generate a new one.");
        }

        String apiKey = "pk_" + token(18);
        String apiSecret = token(32);
        String linkId = "lnk_" + token(12);

        pharmacy.pairEmrClinic(request.emrClinicId().trim(), request.clinicName().trim(), callbackUrl,
                linkId, apiKey, ApiSecretHasher.hash(apiSecret));

        EmrSecretCipher.Encrypted webhook = secretCipher.encrypt(request.webhookSecret().trim());
        pharmacy.setEmrWebhookSecret(webhook.ciphertext(), webhook.iv(), webhook.tag());

        Pharmacy saved = pharmacy;
        SystemContext.runAsSystem(() -> pharmacyRepository.save(saved));

        // Audited without a userId: no member of staff performed this, the clinic did. The
        // clinic id and address are the identifying facts worth keeping, and neither
        // credential is recorded — an audit log is not a place to put a live secret.
        auditService.log(AuditEntry.of(AuditModule.SETTINGS, "EMR_CLINIC_PAIRED", "PHARMACY")
                .pharmacyId(pharmacy.getId()).entityId(pharmacy.getId())
                .newData(Map.of(
                        "clinicName", request.clinicName().trim(),
                        "emrClinicId", request.emrClinicId().trim(),
                        "callbackUrl", callbackUrl,
                        "linkId", linkId)));

        log.info("Clinic {} paired with pharmacy {} (link {})",
                request.emrClinicId(), pharmacy.getId(), linkId);

        return new ClinicPairResponse(apiKey, apiSecret, pharmacy.getId(), pharmacy.getName(), linkId);
    }

    /**
     * Finds the pharmacy whose generated key matches the presented code.
     *
     * <p>The code is the pharmacy's own EMR key, held encrypted — the ciphertext differs
     * every time the same plaintext is encrypted (distinct GCM nonce), which is the property
     * that makes the at-rest encryption worth having, and also why the ciphertext column
     * itself can never be indexed for this lookup.
     *
     * <p>What CAN be indexed, and is: {@code emrSecretLookupHash}, a deterministic SHA-256 of
     * the plaintext (see {@link ApiSecretHasher}), written once at the only moment the
     * plaintext exists server-side — {@code EmrConnectionService#generateKey} and the
     * platform-admin equivalent. A hash match is already the full verification (the same
     * trust level {@code ApiSecretHasher} carries as the SOLE authentication decision for
     * API-key requests elsewhere) — there is nothing more certain to be gained by also
     * decrypting and comparing the plaintext afterward, so this does not.
     *
     * <p>Falls back to the old decrypt-and-compare scan ONLY for the shrinking population
     * whose key predates this column ({@code emrSecretLookupHash IS NULL}) — never the whole
     * pharmacy table again. A wrong code and a code belonging to that not-yet-rotated
     * population are indistinguishable from outside (both fall through to the slow path and
     * both fail), so which one happened is not observable; what IS observable is "hash-tier
     * hit" vs "not" — and that reveals nothing about a specific pharmacy or the 256-bit
     * secret space, unlike a byte-at-a-time comparison leak, so it is not the same class of
     * timing risk the constant-time compare below still guards against within one candidate.
     */
    private Pharmacy findByPairingCode(String code) {
        Pharmacy hashMatch = pharmacyRepository.findByEmrSecretLookupHash(ApiSecretHasher.hash(code))
                .filter(Pharmacy::isActive)
                .orElse(null);
        if (hashMatch != null) {
            return hashMatch;
        }
        return scanCandidatesPredatingTheLookupHash(code);
    }

    /**
     * The pre-{@code emrSecretLookupHash} fallback — decrypts and compares every candidate
     * the old way, exactly as {@link #findByPairingCode} always did, just scoped to the set
     * that column cannot yet help with instead of every pharmacy on the platform.
     *
     * <p>Comparison is constant-time. A short-circuiting compare here would leak how much of
     * a guessed code was correct, which turns forging one from a search of the whole space
     * into a character-at-a-time walk.
     */
    private Pharmacy scanCandidatesPredatingTheLookupHash(String code) {
        byte[] presented = code.getBytes(StandardCharsets.UTF_8);
        List<Pharmacy> candidates =
                pharmacyRepository.findAllByEmrSecretLookupHashIsNullAndEmrSecretCiphertextIsNotNull();
        Pharmacy match = null;
        for (Pharmacy p : candidates) {
            if (!p.isActive()) {
                continue;
            }
            String stored;
            try {
                stored = secretCipher.decrypt(p.getEmrSecretCiphertext(), p.getEmrSecretIv(),
                        p.getEmrSecretTag());
            } catch (Exception e) {
                // A row encrypted under a key this server no longer holds. Not this
                // pharmacy's fault and not this request's problem — skip it, but say so,
                // because silent skipping is how a rotated key becomes a mystery.
                log.error("EMR key for pharmacy {} could not be decrypted during pairing", p.getId(), e);
                continue;
            }
            if (MessageDigest.isEqual(presented, stored.getBytes(StandardCharsets.UTF_8))) {
                // No early return: finishing the loop keeps the work done independent of
                // WHERE the match sits, so timing says nothing about which pharmacy matched.
                match = p;
            }
        }
        return match;
    }

    /**
     * Builds the clinic's callback address from the base URL it gave us.
     *
     * <p>The path is appended rather than asked for: it is fixed by the clinic's own
     * routing, so requesting it would only create a way to get it wrong. Validated as an
     * absolute http(s) URL for the same reason the manual path validates one — a typo here
     * is a delivery that fails forever, discovered later from a stuck queue.
     */
    private String clinicCallbackUrl(String baseUrl) {
        String base = baseUrl == null ? "" : baseUrl.trim();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        try {
            URI uri = new URI(base);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!uri.isAbsolute() || uri.getHost() == null
                    || !(scheme.equals("https") || scheme.equals("http"))) {
                throw new BadRequestException("The clinic address must be a full http(s) URL");
            }
        } catch (URISyntaxException e) {
            throw new BadRequestException("The clinic address must be a full http(s) URL");
        }
        return base + CLINIC_CALLBACK_PATH;
    }

    /** URL-safe token of {@code bytes} bytes of CSPRNG output. */
    private static String token(int bytes) {
        byte[] raw = new byte[bytes];
        RNG.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }
}
