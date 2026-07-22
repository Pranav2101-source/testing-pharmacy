package com.checkup.pharmacy.common.util;

import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Generates collision-resistant, cuid-style string ids (prefixed with 'c') for
 * new primary keys. Prisma generated ids with `@default(cuid())` app-side — since
 * this service is now the writer, it must supply ids itself (the DB has no default
 * on those columns). Format is not byte-for-byte cuid, but is unique, monotonic-ish,
 * and visually consistent with existing ids.
 */
public final class Cuid {

    private static final SecureRandom RNG = new SecureRandom();
    private static final AtomicInteger COUNTER = new AtomicInteger(RNG.nextInt(1 << 24));
    private static final char[] B36 = "0123456789abcdefghijklmnopqrstuvwxyz".toCharArray();

    private Cuid() {
    }

    public static String generate() {
        StringBuilder sb = new StringBuilder(25);
        sb.append('c');
        appendBase36(sb, System.currentTimeMillis(), 8);
        appendBase36(sb, COUNTER.getAndIncrement() & 0xFFFFFF, 4);
        appendBase36(sb, RNG.nextInt() & 0x7FFFFFFF, 6);
        appendBase36(sb, RNG.nextInt() & 0x7FFFFFFF, 6);
        return sb.toString();
    }

    private static void appendBase36(StringBuilder sb, long value, int width) {
        char[] buf = new char[width];
        long v = value;
        for (int i = width - 1; i >= 0; i--) {
            buf[i] = B36[(int) (Math.floorMod(v, 36))];
            v = Math.floorDiv(v, 36);
        }
        sb.append(buf);
    }
}
