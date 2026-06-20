-- Invoice.doctorRegNo: snapshot doctor registration number at billing time.
--
-- The pharmacy billing software is required to print the prescribing doctor's
-- registration number on the invoice under Drug & Cosmetics Act rules for
-- Schedule H / H1 / X medicines. Previously only doctorName was snapshotted;
-- doctorRegNo was not stored, requiring a JOIN back to the doctors table to
-- produce regulatory invoices — which fails if the doctor record is later
-- updated or soft-deleted.
--
-- This column is nullable (many invoices are OTC; no doctor involved),
-- defaults to NULL, and is back-filled from the linked doctor record where
-- a doctorId is already present on the invoice.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "doctorRegNo" TEXT;

-- Back-fill for invoices that already have a doctorId.
UPDATE "invoices" i
SET    "doctorRegNo" = d."registrationNo"
FROM   "doctors" d
WHERE  i."doctorId" = d.id
  AND  d."registrationNo" IS NOT NULL;
