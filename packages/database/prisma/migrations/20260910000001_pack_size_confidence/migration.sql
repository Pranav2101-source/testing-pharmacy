-- Trust state for a medicine's pack multiple.
--
-- WHY THIS EXISTS
--   `medicines."unitsPerPack"` is a DIVISOR. Every mL→bottle conversion, every per-piece
--   price and every loose sale runs through it, so when it is wrong the arithmetic
--   downstream stays perfectly correct and the answer is still absurd: a 40 ml course of a
--   scalp lotion billed as EIGHT bottles, because the catalogue's "5 ml pack" was really the
--   5% concentration typed into the wrong field. Every screen agreed, because every screen
--   divided by the same wrong number. Nothing in the chain held a second fact that could
--   contradict the first.
--
--   These three columns are that second fact, carried on the row itself: how far the number
--   may be trusted, when a human last confirmed it, and where it came from. None of them
--   change what billing computes — a merely unaudited pack size must still sell — they make
--   an unaudited one VISIBLE, which is the part that was missing.
--
-- THREE INDEPENDENT DEFENCES, deliberately at three different levels:
--   1. The service layer assesses corroborating evidence and writes a confidence
--      (see PackSizeEvidence.java). It is the only thing that can produce VERIFIED.
--   2. A CHECK constraint refuses the one shape that is never a real retail pack —
--      a measured (ML/GM) medicine whose sealed pack holds exactly 1 ml / 1 g.
--   3. A BEFORE trigger forces UNVERIFIED / RAW_WRITE onto any write that reaches this
--      table without going through (1). The bad datum in the incident above arrived from a
--      repair script, not from the API, so a defence that only guards the service layer
--      would not have caught it.

-- ── 1. The vocabulary ────────────────────────────────────────────────────────────────────

CREATE TYPE "PackSizeConfidence" AS ENUM ('VERIFIED', 'UNVERIFIED', 'DISPUTED');

CREATE TYPE "PackSizeSource" AS ENUM (
    'CATALOGUE_ADMIN',
    'PHARMACIST',
    'PACK_SIZE_TEXT',
    'BULK_IMPORT',
    'EMR_INGEST',
    'DATA_SCRIPT',
    'RAW_WRITE',
    'BACKFILL'
);

ALTER TABLE "medicines" ADD COLUMN "packSizeConfidence" "PackSizeConfidence";
ALTER TABLE "medicines" ADD COLUMN "packSizeVerifiedAt" TIMESTAMP(3);
ALTER TABLE "medicines" ADD COLUMN "packSizeSource" "PackSizeSource";

-- ── 2. Backfill ──────────────────────────────────────────────────────────────────────────
--
-- Every medicine already carrying a pack size gets UNVERIFIED, not VERIFIED. Nobody
-- recorded who entered any of these or whether it was ever checked, and inventing
-- confidence for a number precisely because it is old would defeat the point of the column.
-- The rows that will not satisfy the CHECK constraint below are labelled DISPUTED instead,
-- so the ones the NOT VALID clause is tolerating are named rather than merely tolerated.
--
-- An unclassified medicine (unitsPerPack IS NULL) is left NULL: nothing is on record, which
-- is a different situation from a number nobody has audited, and the two must not collapse.

UPDATE "medicines"
SET "packSizeConfidence" = CASE
        WHEN "baseUnit" IN ('ML', 'GM') AND "unitsPerPack" = 1 THEN 'DISPUTED'::"PackSizeConfidence"
        ELSE 'UNVERIFIED'::"PackSizeConfidence"
    END,
    "packSizeSource" = 'BACKFILL'
WHERE "unitsPerPack" IS NOT NULL;

-- ── 3. The constraint ────────────────────────────────────────────────────────────────────
--
-- A measured medicine whose sealed pack holds exactly one millilitre or one gram does not
-- exist. There is no 1 ml bottle of syrup and no 1 g tube of cream on any shelf; a
-- unitsPerPack of 1 on an ML/GM row is a strength, a concentration, or a placeholder that
-- someone meant to come back to. Left in place it is the most dangerous possible value,
-- because it makes the mL→pack division a no-op and every millilitre bills as a whole pack.
--
-- NOT VALID on purpose. Existing rows are not scanned, so the migration cannot fail on data
-- that predates the rule and no deploy is blocked by a catalogue nobody has cleaned yet —
-- but every INSERT and every UPDATE from this moment on is checked. The pre-existing rows
-- are recoverable from packSizeConfidence = 'DISPUTED' (set above), and once they are fixed:
--
--     ALTER TABLE "medicines" VALIDATE CONSTRAINT "medicines_measured_pack_size_not_one";
--
-- which takes only a SHARE UPDATE EXCLUSIVE lock and does not block reads or writes.

ALTER TABLE "medicines"
    ADD CONSTRAINT "medicines_measured_pack_size_not_one"
    CHECK (NOT ("baseUnit" IN ('ML', 'GM') AND "unitsPerPack" = 1))
    NOT VALID;

-- ── 4. The trigger ───────────────────────────────────────────────────────────────────────
--
-- HOW THE SERVICE LAYER OPTS OUT
--   Immediately before it writes a Medicine whose confidence it has actually assessed, the
--   API sets a transaction-local GUC:
--
--       SELECT set_config('app.pack_size_evidence', 'on', true);
--
--   is_local => true scopes it to the transaction, exactly as app.pharmacy_id is scoped for
--   row-level security (see 20260719000001_row_level_security), so it cannot leak onto the
--   next borrower of a pooled connection. Any other writer — psql, Prisma Studio, a repair
--   script, a future service that has never heard of this column — simply does not set it,
--   and its write is stamped. That is the right default: a datum whose provenance nothing
--   recorded is by definition unverified.
--
--   A script that genuinely knows what it is doing can opt in the same way, in the same
--   transaction as its UPDATE, and set the three columns itself.
--
-- WHY BEFORE, AND WHY IT CORRECTS RATHER THAN REJECTS
--   Rejecting a raw write would break every legitimate repair path and turn a data-quality
--   signal into an outage. Stamping it downgrades trust instead, which is recoverable by a
--   pharmacist in a few seconds and is visible everywhere the badge is rendered.

CREATE OR REPLACE FUNCTION stamp_unverified_pack_size() RETURNS trigger AS $$
BEGIN
    -- Invariant, enforced for every writer including the service layer: with no pack size on
    -- record there is nothing to be confident about. A confidence left stranded on a row
    -- whose unitsPerPack was cleared would read as "checked" forever.
    IF NEW."unitsPerPack" IS NULL THEN
        NEW."packSizeConfidence" := NULL;
        NEW."packSizeVerifiedAt" := NULL;
        NEW."packSizeSource"     := NULL;
        RETURN NEW;
    END IF;

    -- Nothing about the packaging OR its trust state moved. Covers the common case by a wide
    -- margin: Hibernate rewrites every column on every UPDATE, so an unrelated edit (a
    -- rename, a GST change, a barcode) arrives here looking like a packaging write.
    IF TG_OP = 'UPDATE'
       AND NEW."unitsPerPack"       IS NOT DISTINCT FROM OLD."unitsPerPack"
       AND NEW."baseUnit"           IS NOT DISTINCT FROM OLD."baseUnit"
       AND NEW."packSizeConfidence" IS NOT DISTINCT FROM OLD."packSizeConfidence"
       AND NEW."packSizeVerifiedAt" IS NOT DISTINCT FROM OLD."packSizeVerifiedAt"
       AND NEW."packSizeSource"     IS NOT DISTINCT FROM OLD."packSizeSource" THEN
        RETURN NEW;
    END IF;

    -- The service layer has assessed this write and owns the three columns.
    IF current_setting('app.pack_size_evidence', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Everything else. The supplied values are overwritten rather than defaulted: a raw write
    -- asserting VERIFIED is precisely the claim this trigger exists to disbelieve.
    NEW."packSizeConfidence" := 'UNVERIFIED';
    NEW."packSizeVerifiedAt" := NULL;
    NEW."packSizeSource"     := 'RAW_WRITE';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UPDATE OF <columns> keeps the function off the hot path for edits that never name a
-- packaging column at all (a targeted UPDATE ... SET "isActive" = false, say). Hibernate
-- names every column, so it still runs for ordinary API writes — and the IS NOT DISTINCT
-- FROM block above is what makes those cheap.
DROP TRIGGER IF EXISTS "medicines_stamp_unverified_pack_size" ON "medicines";
CREATE TRIGGER "medicines_stamp_unverified_pack_size"
    BEFORE INSERT OR UPDATE OF
        "unitsPerPack", "baseUnit", "packSizeConfidence", "packSizeVerifiedAt", "packSizeSource"
    ON "medicines"
    FOR EACH ROW
    EXECUTE FUNCTION stamp_unverified_pack_size();
