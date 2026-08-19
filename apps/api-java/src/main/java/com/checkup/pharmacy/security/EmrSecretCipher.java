package com.checkup.pharmacy.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * AES-256-GCM at-rest encryption for each pharmacy's own EMR HMAC secret
 * (see {@link EmrHmacAuthenticationFilter}). This is the Java-side twin of
 * the EMR repo's {@code pharmacyIntegration.crypto.ts} — same key shape
 * (32 bytes, hex or base64), same 12-byte GCM nonce — but the two never
 * decrypt each other's ciphertext; each service only ever reads back what
 * it wrote.
 */
@Component
public class EmrSecretCipher {

    private static final Pattern HEX_64 = Pattern.compile("^[a-fA-F0-9]{64}$");
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int TAG_BYTES = TAG_BITS / 8;

    private final String rawKey;
    private final SecureRandom random = new SecureRandom();

    public EmrSecretCipher(@Value("${app.integration.emr.encryption-key:}") String rawKey) {
        this.rawKey = rawKey;
    }

    public boolean isConfigured() {
        return !rawKey.isBlank();
    }

    public record Encrypted(String ciphertext, String iv, String tag) {
    }

    public Encrypted encrypt(String plainText) {
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] combined = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext = Arrays.copyOfRange(combined, 0, combined.length - TAG_BYTES);
            byte[] tag = Arrays.copyOfRange(combined, combined.length - TAG_BYTES, combined.length);
            return new Encrypted(b64(ciphertext), b64(iv), b64(tag));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to encrypt EMR secret", e);
        }
    }

    public String decrypt(String ciphertext, String iv, String tag) {
        try {
            byte[] combined = concat(Base64.getDecoder().decode(ciphertext), Base64.getDecoder().decode(tag));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, Base64.getDecoder().decode(iv)));
            return new String(cipher.doFinal(combined), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to decrypt EMR secret", e);
        }
    }

    private SecretKeySpec key() {
        if (rawKey.isBlank()) throw new IllegalStateException("EMR connection encryption is not configured");
        byte[] keyBytes = HEX_64.matcher(rawKey).matches()
                ? hexToBytes(rawKey)
                : Base64.getDecoder().decode(rawKey);
        if (keyBytes.length != 32) {
            throw new IllegalStateException("app.integration.emr.encryption-key must encode exactly 32 bytes");
        }
        return new SecretKeySpec(keyBytes, "AES");
    }

    private static byte[] hexToBytes(String hex) {
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static String b64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }
}
