package com.checkup.pharmacy.common.enums;

/**
 * How far a medicine's {@code unitsPerPack} may be trusted.
 *
 * <p>Mirrors the Postgres {@code "PackSizeConfidence"} enum (migration
 * {@code 20260910000001_pack_size_confidence}); the constant names are the stored values, so
 * they cannot be renamed without a migration.
 *
 * <p>NULL — the absence of any value here — is a fourth state and a meaningful one: the
 * medicine has no pack size on record at all, so there is nothing to be confident or doubtful
 * about. That is deliberately NOT the same as {@link #UNVERIFIED}, and code that collapses the
 * two will refuse to sell an unclassified medicine loose (correct) for the wrong reason, or
 * flag every unclassified medicine as suspect (wrong).
 *
 * @see com.checkup.pharmacy.common.util.PackSizeEvidence
 */
public enum PackSizeConfidence {

    /**
     * A human confirmed the number against a physical pack, or two independent facts on the
     * record agree about it. The only state the service layer can arrive at deliberately.
     */
    VERIFIED,

    /**
     * A pack size is on record and nothing corroborates it.
     *
     * <p>Still used for every calculation. An unaudited divisor is not a wrong one, and a
     * pharmacy cannot stop billing while somebody checks a carton — the value of this state is
     * that it is VISIBLE, not that it blocks anything.
     */
    UNVERIFIED,

    /**
     * The pack size contradicts another fact on the same SKU: it equals a strength or
     * concentration printed on the row, or a measured medicine claims a sealed pack of exactly
     * 1&nbsp;ml / 1&nbsp;g.
     *
     * <p>The service write path refuses to persist this, so in practice it labels rows that
     * predate the guard (backfilled by the migration) and anything that reached the table
     * another way.
     */
    DISPUTED
}
