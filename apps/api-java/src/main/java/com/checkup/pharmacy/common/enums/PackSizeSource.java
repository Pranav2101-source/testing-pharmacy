package com.checkup.pharmacy.common.enums;

/**
 * Where the pack size currently on a {@code Medicine} row came from.
 *
 * <p>Kept beside {@link PackSizeConfidence} because the two answer different questions. A
 * pharmacist's tick and a bulk CSV row can both land on {@code VERIFIED}; only this says which
 * one to go back to when the number turns out to be wrong, and which OTHER rows are likely to
 * be wrong for the same reason. The Melgain incident was one bad row from one repair script —
 * with this column, finding its siblings is a query rather than an audit.
 *
 * <p>Mirrors the Postgres {@code "PackSizeSource"} enum (migration
 * {@code 20260910000001_pack_size_confidence}); adding a value needs an {@code ALTER TYPE}.
 */
public enum PackSizeSource {

    /** A platform admin typed it into the shared catalogue form. */
    CATALOGUE_ADMIN,

    /** A pharmacist confirmed it against a pack in their hand. */
    PHARMACIST,

    /** Corroborated by the medicine's own free-text {@code packSize} ("100 ml bottle"). */
    PACK_SIZE_TEXT,

    /** A row in a bulk catalogue upload. */
    BULK_IMPORT,

    /** Resolved while ingesting a clinic prescription. */
    EMR_INGEST,

    /** One of {@code packages/database/scripts} — a repair run, not a workflow. */
    DATA_SCRIPT,

    /**
     * Written straight to the table, bypassing the service layer: psql, Prisma Studio, a repair
     * script that does not opt in, a future service that has never heard of these columns.
     *
     * <p>Stamped by the {@code medicines_stamp_unverified_pack_size} trigger and never by
     * application code. Seeing it means the write path that produced the row is not one this
     * codebase knows about — which is worth knowing on its own.
     */
    RAW_WRITE,

    /** Classified before these columns existed. Set once, by migration 20260910000001. */
    BACKFILL
}
