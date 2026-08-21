package com.checkup.pharmacy.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * One-way hashing for machine API secrets.
 *
 * <h2>Why SHA-256 and not bcrypt/argon2</h2>
 * A slow key-derivation function exists to make guessing expensive when the input is a
 * human-chosen password — a few dozen bits of entropy drawn from a distribution an
 * attacker can model. These secrets are 256 bits from a {@code SecureRandom}: there is no
 * distribution to model and no dictionary to walk, and no amount of arithmetic slowdown
 * changes a search space that size from "impossible" to "more impossible".
 *
 * <p>What a slow hash <em>would</em> change is latency, on every machine request, on the
 * authentication path — the one place in the system where cost is paid per call and
 * cannot be cached. That is a real cost for no security gain.
 *
 * <p><b>This is for machine secrets only.</b> User passwords are human-chosen, low-entropy
 * and reused across sites; they go through the password encoder and must never be brought
 * near this class.
 *
 * @see EmrApiKeyAuthenticationFilter
 */
public final class ApiSecretHasher {

    private ApiSecretHasher() {
    }

    /** Hex-encoded SHA-256 of the secret, or null for a null input. */
    public static String hash(String secret) {
        if (secret == null) {
            return null;
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(secret.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    /**
     * Constant-time comparison of a presented secret against a stored hash.
     *
     * <p>Hashes the candidate first, then compares digest to digest with
     * {@link MessageDigest#isEqual}. A plain {@code equals} returns on the first differing
     * byte, and the time it takes to do so leaks how much of a guess was correct — which
     * turns forging a credential from a search of the whole space into a byte-at-a-time
     * walk. That the compared values are hashes rather than the secrets themselves does
     * not make the leak harmless; it just moves what is being learned.
     */
    public static boolean matches(String presentedSecret, String storedHash) {
        if (presentedSecret == null || storedHash == null) {
            return false;
        }
        String candidate = hash(presentedSecret);
        return MessageDigest.isEqual(
                candidate.getBytes(StandardCharsets.US_ASCII),
                storedHash.getBytes(StandardCharsets.US_ASCII));
    }
}
