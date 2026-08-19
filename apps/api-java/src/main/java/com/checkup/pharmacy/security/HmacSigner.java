package com.checkup.pharmacy.security;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Shared wire-level HMAC contract for EMR machine requests and callbacks. */
public final class HmacSigner {

    private static final String ALGORITHM = "HmacSHA256";

    private HmacSigner() {
    }

    public static String sign(String secret, String timestamp, String method, String path,
                              String pharmacyId, byte[] body) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("EMR integration secret is not configured");
        }
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return "sha256=" + HexFormat.of().formatHex(mac.doFinal(
                    canonical(timestamp, method, path, pharmacyId, body)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", e);
        }
    }

    public static boolean verify(String expected, String supplied) {
        if (expected == null || supplied == null) {
            return false;
        }
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII),
                supplied.getBytes(StandardCharsets.US_ASCII));
    }

    private static byte[] canonical(String timestamp, String method, String path,
                                    String pharmacyId, byte[] body) {
        byte[] prefix = (timestamp + "\n" + method.toUpperCase() + "\n" + path + "\n"
                + pharmacyId + "\n").getBytes(StandardCharsets.UTF_8);
        byte[] canonical = new byte[prefix.length + body.length];
        System.arraycopy(prefix, 0, canonical, 0, prefix.length);
        System.arraycopy(body, 0, canonical, prefix.length, body.length);
        return canonical;
    }
}
