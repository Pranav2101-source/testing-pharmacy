-- Upload.invoiceId: drop the dead column.
--
-- This field was declared as String? on the Upload model but:
--   1. No Prisma @relation was ever defined — no FK constraint exists.
--   2. No application code writes it (grep across api/ and web/ returns nothing).
--   3. No application code reads it.
--
-- It was likely a placeholder for a planned "attach PDF to invoice" feature
-- that was never built. Keeping it creates a misleading implied contract:
-- readers assume querying upload.invoiceId yields something meaningful.
-- Drop it cleanly now; if invoice PDF linking is needed later, add it with
-- a proper FK relation to invoices.id.

ALTER TABLE "uploads" DROP COLUMN IF EXISTS "invoiceId";
