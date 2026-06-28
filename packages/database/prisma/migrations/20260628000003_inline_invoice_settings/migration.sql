-- Migration A (additive only): inlines the invoice_settings table (a strict 1:1
-- with pharmacies, keyed by pharmacyId @unique, holding a single JSON blob) into
-- a new pharmacies."invoiceSettings" JSONB column.
--
-- Verified beforehand: invoice_settings was only ever read by pharmacyId
-- (billing.repo.getSettings) and written via upsert (billing.service.saveInvoiceSettings).
-- No cross-row query, report, or aggregate ever touched it, so the separate
-- table only added a join. Application code already reads/writes the column.
--
-- The legacy invoice_settings table is intentionally left in place, untouched
-- and unused by application code after this ships. Dropping it is a deliberate
-- separate follow-up (Migration B below), gated on this having run cleanly.

-- ── pharmacies: invoiceSettings JSON ───────────────────────────────────────

ALTER TABLE "pharmacies" ADD COLUMN "invoiceSettings" JSONB;

UPDATE "pharmacies" p
SET "invoiceSettings" = s."settings"
FROM "invoice_settings" s
WHERE s."pharmacyId" = p.id;

-- ── Migration B (run later, after this has soaked) ─────────────────────────
-- DROP TABLE "invoice_settings";
