-- The self-healing feedback loop: capture the counter's disagreement with the engine.
--
-- Phases 1 and 2 reason about a pack size without ever seeing the product — a plausibility
-- ceiling, and a record of whether anybody had checked the divisor. Both are inferences.
-- The one place the inference meets the physical object is a pharmacist at the shelf, who
-- reads "8 bottles", picks up one, and bills that instead. That disagreement was thrown
-- away the moment the bill saved. This table keeps it.
--
-- A single disagreement means almost nothing — patients ask for less, shelves run short,
-- doctors get called — so nothing here is treated as an assertion. Signals are votes, and
-- PackSizeReviewJob acts only on a quorum of them from more than one pharmacy. Even then
-- the outcome is quarantine plus a review task, never an automatic rewrite of the volume:
-- this table has not held the bottle either.

CREATE TABLE "pack_size_signals" (
    "id"                 TEXT NOT NULL,
    "pharmacyId"         TEXT NOT NULL,
    "medicineId"         TEXT NOT NULL,
    "invoiceId"          TEXT,
    "prescriptionItemId" TEXT,

    -- What the engine asked for, and what actually went over the counter.
    "enginePackCount" INTEGER NOT NULL,
    "actualPackCount" INTEGER NOT NULL,
    -- The clinical figure the conversion started from, and the divisor it used.
    "clinicalVolume"   DECIMAL(12,2) NOT NULL,
    "declaredPackSize" INTEGER NOT NULL,
    -- clinicalVolume / actualPackCount: what one pack would have to hold for the
    -- pharmacist's count to be right. A LOWER BOUND, not a measurement.
    "impliedPackSize" INTEGER NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Present because a signal is NOT append-only — the quorum sweep stamps resolvedAt
    -- afterwards. CreatedAtEntity's javadoc is explicit that a mutable row needs this
    -- column, so the Java side maps to BaseEntity.
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- Stamped once a quorum sweep has counted this signal, so one medicine is not
    -- re-quarantined every night off the same handful of votes.
    "resolvedAt"     TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "pack_size_signals_pkey" PRIMARY KEY ("id")
);

-- Cascade from pharmacy and medicine (a signal about a deleted medicine is meaningless),
-- but SET NULL from the invoice: the evidence a quarantine was based on has to outlive the
-- receipt it came from, or a reviewer opens the task and finds nothing behind it.
ALTER TABLE "pack_size_signals"
    ADD CONSTRAINT "pack_size_signals_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pack_size_signals"
    ADD CONSTRAINT "pack_size_signals_medicineId_fkey"
    FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pack_size_signals"
    ADD CONSTRAINT "pack_size_signals_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The quorum sweep's access path: open signals grouped by medicine.
CREATE INDEX "pack_size_signals_medicineId_resolvedAt_idx"
    ON "pack_size_signals"("medicineId", "resolvedAt");
CREATE INDEX "pack_size_signals_pharmacyId_createdAt_idx"
    ON "pack_size_signals"("pharmacyId", "createdAt");

-- Row-Level Security: same fail-closed tenant policy as every other pharmacy-owned table
-- (see 20260719000001_row_level_security). A new table starts with RLS OFF, so this is not
-- housekeeping — without it one pharmacy could read another's dispensing corrections.
--
-- The quorum job reads ACROSS tenants by definition, and reaches these rows through the
-- app.bypass_rls escape below, granted by @CrossTenant. That is deliberate and is the only
-- cross-tenant reader: counting agreement between pharmacies is the entire mechanism.
ALTER TABLE "pack_size_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pack_size_signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pack_size_signals"
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR "pharmacyId" = current_setting('app.pharmacy_id', true)
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR "pharmacyId" = current_setting('app.pharmacy_id', true)
    );
