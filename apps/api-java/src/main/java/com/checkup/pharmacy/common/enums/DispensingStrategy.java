package com.checkup.pharmacy.common.enums;

/**
 * Mirrors the Prisma {@code DispensingStrategy} enum — how
 * {@link com.checkup.pharmacy.modules.dispensing.DispensingService} orders the
 * in-stock batches of one medicine when it has to pick.
 *
 * <p>Only ACTIVE, in-date, sellable batches are ever candidates under either
 * value; this only decides the order among those.
 */
public enum DispensingStrategy {

    /**
     * Last In, Last Available — earliest valid expiry first (a.k.a. FEFO). The
     * default: sells older stock before it expires and minimises write-offs.
     */
    LILA_FEFO,

    /**
     * Last In, First Available — most recently received batch first. A deliberate
     * opt-in for pharmacies that want to move the freshest stock.
     */
    LIFA;

    /** The strategy a pharmacy has when nothing has been configured. */
    public static final DispensingStrategy DEFAULT = LILA_FEFO;

    /** Parses a client-supplied value, rejecting anything unrecognised. */
    public static DispensingStrategy parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("dispensing strategy is required");
        }
        try {
            return valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(
                    "Unknown dispensing strategy \"" + raw + "\" — expected LILA_FEFO or LIFA");
        }
    }
}
