-- Telling the clinic a prescription was withdrawn — the mirror of 20260819000003's dispense
-- callback. That migration closed the loop for "what was dispensed"; this closes it for
-- "this prescription no longer stands", which was open until now: a pharmacist cancelling a
-- clinic-sourced prescription was a purely local write, and the clinic had no way to find
-- out its patient's script had been withdrawn at the pharmacy end.
--
-- Same shape, same reasoning as dispenseNotify* — see that migration's comment for why each
-- column exists. NULL throughout means "never applied": a counter-written prescription, or
-- one from a clinic that was never cancelled from this side.
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "cancelNotifyStatus"        TEXT;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "cancelNotifiedAt"          TIMESTAMP(3);
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "cancelNotifyError"         TEXT;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "cancelNotifyAttempts"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "cancelNotifyNextAttemptAt" TIMESTAMP(3);

-- Backlog index, same partial shape as the dispense-notify one: almost every row holds NULL
-- here, so only the rows actually owed a callback are worth indexing.
CREATE INDEX IF NOT EXISTS "prescriptions_cancel_notify_due_idx"
    ON "prescriptions" ("pharmacyId", "cancelNotifyNextAttemptAt")
    WHERE "cancelNotifyStatus" IN ('PENDING', 'FAILED');
