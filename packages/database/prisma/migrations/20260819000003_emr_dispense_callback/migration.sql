-- Telling the clinic what was actually dispensed — the return leg of the EMR integration.
--
-- 20260819000001 made prescriptions arrive from a clinic. Nothing goes back. A chart that
-- records what a doctor prescribed, and never whether the patient collected it, is missing
-- the half a clinician acts on: repeat scripts get written for medicine already dispensed,
-- and non-adherence is invisible.
--
-- WHY THE STATUS COLUMNS EXIST
-- The callback fires after a sale has committed and is deliberately allowed to fail — a sale
-- must never be blocked because an EMR server is unreachable. But "allowed to fail" and
-- "allowed to fail silently" are different things. Without somewhere to record the outcome,
-- an EMR whose endpoint has been broken for a week shows charts that quietly disagree with
-- reality and nobody finds out. These columns are what make that visible and retryable.
--
-- Nullable throughout, and NULL is meaningful: it marks a prescription this never applied to
-- — anything typed at the counter rather than pushed by a clinic, which is most of them.
--
-- Additive and idempotent. Safe to apply ahead of the code that writes it: existing code
-- ignores columns it does not know about.

ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "dispenseNotifyStatus" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "dispenseNotifiedAt"   TIMESTAMP(3);
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "dispenseNotifyError"  TEXT;

-- How many delivery attempts this prescription has cost. Drives the backoff and the cap that
-- stops a permanently-broken endpoint being retried forever. NOT NULL DEFAULT 0 so existing
-- rows join the scheme at attempt zero rather than as NULLs every comparison special-cases.
ALTER TABLE "prescriptions"
    ADD COLUMN IF NOT EXISTS "dispenseNotifyAttempts" INTEGER NOT NULL DEFAULT 0;

-- When the sweeper may next try.
--
-- NULL means NOTHING IS SCHEDULED, and only that — a delivered callback and a given-up
-- failure both land here. It deliberately does NOT mean "due now": a sale sets this to the
-- commit instant rather than leaving it NULL, so the sweeper's predicate stays one
-- unambiguous comparison instead of a NULL case that reads differently depending on which
-- status sits beside it.
--
-- Storing the next attempt time, rather than deriving it from attempts + a last-attempt
-- stamp, keeps that check a single indexable predicate. Derived backoff would put interval
-- arithmetic in the WHERE clause, which no index can serve.
ALTER TABLE "prescriptions"
    ADD COLUMN IF NOT EXISTS "dispenseNotifyNextAttemptAt" TIMESTAMP(3);

-- Finds the backlog. Partial, because the overwhelming majority of prescriptions are
-- counter-written and hold NULL here — indexing those is indexing "not applicable" several
-- hundred thousand times. The sweeper's predicate is (status, due), so the due column has to
-- be in the index or every run reads the whole backlog to discard most of it.
CREATE INDEX IF NOT EXISTS "prescriptions_dispense_notify_due_idx"
    ON "prescriptions" ("pharmacyId", "dispenseNotifyNextAttemptAt")
    WHERE "dispenseNotifyStatus" IN ('PENDING', 'FAILED');

-- ─── What was actually handed over ──────────────────────────────────────────────────────

-- The medicine the patient actually received, when it is not the one prescribed.
--
-- NULL is the normal case and means "what was prescribed". Deliberately SEPARATE from
-- "medicineId" rather than overwriting it: a prescription line records what a doctor ordered
-- and must stay legible as that forever. Overwriting it would mean "which prescriptions
-- ordered drug X" silently stops finding the ones where X was swapped out — exactly the query
-- a recall or an audit runs.
--
-- The name is denormalised beside the id because the callback runs on a background thread
-- with no tenant and a hard timeout budget; resolving a name through a join there would add a
-- query per line to the one code path that must stay cheap and must not fail.
ALTER TABLE "prescription_items"
    ADD COLUMN IF NOT EXISTS "dispensedMedicineId"   TEXT;

ALTER TABLE "prescription_items"
    ADD COLUMN IF NOT EXISTS "dispensedMedicineName" TEXT;

-- No FK on "dispensedMedicineId", matching "medicineId" on this table. The catalogue is
-- shared platform-wide and rows are soft-deleted rather than removed, so a constraint buys
-- nothing and would turn a catalogue cleanup into a failed dispensing record.
