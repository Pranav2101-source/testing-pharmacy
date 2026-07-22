package com.checkup.pharmacy.common.util;

/**
 * Detects a file's real type from its first bytes rather than trusting the
 * client-supplied Content-Type header — used wherever an upload accepts a
 * mixed set of binary formats and must reject a mislabeled/malicious file
 * (e.g. an HTML/SVG payload renamed to `.jpg`) before it's served back with
 * {@code Content-Type: image/jpeg}.
 */
public final class MagicBytes {

    private MagicBytes() {
    }

    /** Returns the sniffed MIME type, or {@code null} if the bytes don't match any recognized signature. */
    public static String detect(byte[] bytes) {
        if (bytes == null || bytes.length < 4) {
            return null;
        }
        if (match(bytes, 0, 0xFF, 0xD8, 0xFF)) {
            return "image/jpeg";
        }
        if (bytes.length >= 8 && match(bytes, 0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) {
            return "image/png";
        }
        if (match(bytes, 0, 'G', 'I', 'F', '8')) {
            return "image/gif";
        }
        if (bytes.length >= 12 && match(bytes, 0, 'R', 'I', 'F', 'F') && match(bytes, 8, 'W', 'E', 'B', 'P')) {
            return "image/webp";
        }
        if (match(bytes, 0, 0x25, 'P', 'D', 'F')) {
            return "application/pdf";
        }
        if (match(bytes, 0, 0x1A, 0x45, 0xDF, 0xA3)) {
            return "video/webm";
        }
        if (bytes.length >= 12 && match(bytes, 4, 'f', 't', 'y', 'p')) {
            return "video/mp4";
        }
        return null;
    }

    private static boolean match(byte[] bytes, int offset, int... expected) {
        if (offset + expected.length > bytes.length) {
            return false;
        }
        for (int i = 0; i < expected.length; i++) {
            if ((bytes[offset + i] & 0xFF) != expected[i]) {
                return false;
            }
        }
        return true;
    }
}
