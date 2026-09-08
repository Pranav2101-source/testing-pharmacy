-- Reconcile the Supabase schema with schema.prisma after a period of `prisma db push`.
--
-- Started from `prisma migrate diff --from-url <prod> --to-schema-datamodel schema.prisma`
-- (2026-09-08), then HAND-EDITED so it is also a clean no-op when the migration
-- history is replayed from scratch into a shadow DB. Validated with
-- `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel
-- ./prisma/schema.prisma --shadow-database-url <local>` → exit 0.
--
-- Two classes of drift are folded together here:
--   (a) present in BOTH a clean replay and prod (real migrations↔schema gaps):
--       - 5 legacy tables never dropped by a migration but removed from schema.prisma
--         (invoice_settings, purchase_order_items, supplier_credit_notes,
--          supplier_payments, supplier_return_items)
--       - 4 FKs at ON DELETE RESTRICT that schema.prisma wants ON DELETE SET NULL
--       - 3 indexes that only schema.prisma has / names that changed
--       - AuditModule.INTEGRATION removed from schema.prisma
--   (b) prod-only, left by `db push` (guarded so a clean replay skips them):
--       - tables api_credentials, clinic_links, pairing_codes
--       - prescriptions.{emrClinicId,emrDoctorId,emrPatientId,emrPrescriptionId,sourceSystem}
--       - prescription_items.{computedQuantity,emrItemId,quantityConfirmed,substitutedFromMedicineId}
--       - prescriptions.{dispenseNotifiedAt,dispenseNotifyNextAttemptAt} as timestamptz
--
-- Verified read-only against prod before writing (see reconcile/ANALYSIS.md):
--   * all 8 dropped tables            : 0 rows, 0 inbound FKs, 0 dependent views
--   * audit_logs.module = 'INTEGRATION': 0 rows
--   * dropped columns                 : 0 non-null, except quantityConfirmed = 100% true
--                                       (and unmapped by the current Hibernate entity)
--   * prescriptions.dispenseNotifiedAt: 24 non-null;  dispenseNotifyNextAttemptAt: 0 non-null
--
-- Apply with `prisma migrate deploy` against the session pooler
-- (aws-1-…pooler.supabase.com:5432) — the home network blocks the direct 5432 host.
-- `migrate deploy` wraps this whole file in ONE transaction (Postgres has
-- transactional DDL), so it is all-or-nothing — there is intentionally no inner
-- BEGIN/COMMIT that could commit part of it early.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AuditModule enum: drop the unused INTEGRATION variant (0 audit_logs rows use it).
--    Standard enum-narrowing dance; brief ACCESS EXCLUSIVE on audit_logs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE "AuditModule_new" AS ENUM ('AUTH', 'TENANTS', 'SUBSCRIPTIONS', 'SUPPORT', 'SETTINGS', 'SYSTEM', 'ANALYTICS', 'AUDIT', 'BILLING', 'INVENTORY');
ALTER TABLE "audit_logs" ALTER COLUMN "module" DROP DEFAULT;
ALTER TABLE "audit_logs" ALTER COLUMN "module" TYPE "AuditModule_new" USING ("module"::text::"AuditModule_new");
ALTER TYPE "AuditModule" RENAME TO "AuditModule_old";
ALTER TYPE "AuditModule_new" RENAME TO "AuditModule";
DROP TYPE "AuditModule_old";
ALTER TABLE "audit_logs" ALTER COLUMN "module" SET DEFAULT 'SYSTEM';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-point 4 foreign keys RESTRICT → SET NULL (schema.prisma default for these
--    optional relations), and drop the FK on the soon-to-be-dropped
--    prescription_items.substitutedFromMedicineId column.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "inventory"               DROP CONSTRAINT IF EXISTS "inventory_medicineId_fkey";
ALTER TABLE "inventory"               ADD  CONSTRAINT "inventory_medicineId_fkey"
  FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grn_items"               DROP CONSTRAINT IF EXISTS "grn_items_medicineId_fkey";
ALTER TABLE "grn_items"               ADD  CONSTRAINT "grn_items_medicineId_fkey"
  FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_ledger_entries" DROP CONSTRAINT IF EXISTS "supplier_ledger_entries_grnId_fkey";
ALTER TABLE "supplier_ledger_entries" ADD  CONSTRAINT "supplier_ledger_entries_grnId_fkey"
  FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_ledger_entries" DROP CONSTRAINT IF EXISTS "supplier_ledger_entries_supplierReturnId_fkey";
ALTER TABLE "supplier_ledger_entries" ADD  CONSTRAINT "supplier_ledger_entries_supplierReturnId_fkey"
  FOREIGN KEY ("supplierReturnId") REFERENCES "supplier_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "prescription_items"      DROP CONSTRAINT IF EXISTS "prescription_items_substitutedFromMedicineId_fkey";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes: drop those referencing dropped columns / recreated below.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "prescriptions_pharmacyId_sourceSystem_createdAt_idx";  -- (b) prod-only; indexes sourceSystem
DROP INDEX IF EXISTS "goods_receipt_notes_pharmacyId_status_createdAt_idx";  -- (a) recreated ASC to match schema (was createdAt DESC)
DROP INDEX IF EXISTS "pharmacies_emrApiKey_key";                             -- (a) partial → plain unique (schema models a plain @unique; Prisma can't express a partial index)

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop dead columns.  IF EXISTS → no-op on a clean replay (these were only ever
--    added by `db push`).  IRREVERSIBLE on prod, but every one is 0 non-null
--    (quantityConfirmed is 100% `true` and unmapped by the current entity).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "prescription_items"
  DROP COLUMN IF EXISTS "computedQuantity",
  DROP COLUMN IF EXISTS "emrItemId",
  DROP COLUMN IF EXISTS "quantityConfirmed",
  DROP COLUMN IF EXISTS "substitutedFromMedicineId";

ALTER TABLE "prescriptions"
  DROP COLUMN IF EXISTS "emrClinicId",
  DROP COLUMN IF EXISTS "emrDoctorId",
  DROP COLUMN IF EXISTS "emrPatientId",
  DROP COLUMN IF EXISTS "emrPrescriptionId",
  DROP COLUMN IF EXISTS "sourceSystem";

-- (b) prod-only: two notify columns are timestamptz (leftover from migration
-- 20260618000005); every sibling notify column is `timestamp`. Convert via UTC so
-- the stored instant is preserved as naive-UTC. Guarded: a clean replay already has
-- these as timestamp(3) and must be left alone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prescriptions'
      AND column_name = 'dispenseNotifiedAt' AND data_type = 'timestamp with time zone'
  ) THEN
    EXECUTE '
      ALTER TABLE "prescriptions"
        ALTER COLUMN "dispenseNotifiedAt"          TYPE TIMESTAMP(3) USING ("dispenseNotifiedAt"          AT TIME ZONE ''UTC''),
        ALTER COLUMN "dispenseNotifyNextAttemptAt" TYPE TIMESTAMP(3) USING ("dispenseNotifyNextAttemptAt" AT TIME ZONE ''UTC'')';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Drop the superseded tables. CASCADE removes each table's own constraints in
--    one step (0 inbound FKs verified). IF EXISTS covers the 3 that a clean replay
--    never created (api_credentials / clinic_links / pairing_codes).
--      api_credentials / clinic_links / pairing_codes → old EMR pairing design
--      invoice_settings                               → inlined to pharmacies.invoiceSettings (Json)
--      purchase_order_items / supplier_return_items   → folded into *.items (Json)
--      supplier_credit_notes / supplier_payments      → merged into supplier_ledger_entries
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "api_credentials"       CASCADE;
DROP TABLE IF EXISTS "clinic_links"          CASCADE;
DROP TABLE IF EXISTS "invoice_settings"      CASCADE;
DROP TABLE IF EXISTS "pairing_codes"         CASCADE;
DROP TABLE IF EXISTS "purchase_order_items"  CASCADE;
DROP TABLE IF EXISTS "supplier_credit_notes" CASCADE;
DROP TABLE IF EXISTS "supplier_payments"     CASCADE;
DROP TABLE IF EXISTS "supplier_return_items" CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Create indexes to match schema.prisma.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "goods_receipt_notes_pharmacyId_status_createdAt_idx"
  ON "goods_receipt_notes" ("pharmacyId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "inventory_pharmacyId_status_medicineId_createdAt_idx"
  ON "inventory" ("pharmacyId", "status", "medicineId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "inventory_movements_inventoryId_direction_type_createdAt_idx"
  ON "inventory_movements" ("inventoryId", "direction", "type", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "pharmacies_emrApiKey_key" ON "pharmacies" ("emrApiKey");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Normalise the EMR-prescription unique-index name to Prisma's convention.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER INDEX IF EXISTS "prescriptions_pharmacyId_externalEmrTenantId_externalEmrPrescri"
  RENAME TO "prescriptions_pharmacyId_externalEmrTenantId_externalEmrPre_key";
