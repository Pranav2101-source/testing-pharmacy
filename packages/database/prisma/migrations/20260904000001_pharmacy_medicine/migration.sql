-- GRN Phase 1: a supplier invoice medicine not yet in the global catalog must
-- still be received, stocked, sold, and GST-reported — never block the GRN.
--
-- Adds a pharmacy-owned stand-in identity, `pharmacy_medicines`, and lets
-- `grn_items`/`inventory` point at EITHER the global `medicines` catalog OR a
-- local row, never both, never neither. Purely additive: every existing row
-- already has `medicineId` set and `localMedicineId` NULL, which already
-- satisfies the new CHECK constraint below — no backfill needed.
--
-- Matching to the global catalog happens later, in the background (see
-- GrnConfirmedEvent / the async matcher) and only ever sets
-- pharmacy_medicines.linkedMedicineId — it never rewrites a GRN item, a batch,
-- or an invoice line that already exists.

-- ── pharmacy_medicines ───────────────────────────────────────────────────────

CREATE TYPE "MedicineMatchStatus" AS ENUM ('PENDING', 'SUGGESTED', 'LINKED', 'KEPT_LOCAL');

CREATE TABLE "pharmacy_medicines" (
    "id"               TEXT NOT NULL,
    "pharmacyId"       TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "manufacturer"     TEXT,
    "genericName"      TEXT,
    "strength"         TEXT,
    "form"             TEXT,
    "unit"             TEXT,
    "hsnCode"          TEXT,
    "gstRate"          DECIMAL(12,2) NOT NULL,
    "schedule"         TEXT,
    "linkedMedicineId" TEXT,
    "matchStatus"      "MedicineMatchStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_medicines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pharmacy_medicines"
  ADD CONSTRAINT "pharmacy_medicines_pharmacyId_fkey"
  FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pharmacy_medicines"
  ADD CONSTRAINT "pharmacy_medicines_linkedMedicineId_fkey"
  FOREIGN KEY ("linkedMedicineId") REFERENCES "medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pharmacy_medicines_pharmacyId_name_idx" ON "pharmacy_medicines"("pharmacyId", "name");
CREATE INDEX "pharmacy_medicines_pharmacyId_matchStatus_idx" ON "pharmacy_medicines"("pharmacyId", "matchStatus");

-- Row-Level Security: same fail-closed tenant policy as every other pharmacy-owned
-- table (see migration 20260719000001_row_level_security for the full rationale).
-- A brand-new table starts with RLS OFF, so this is not optional housekeeping —
-- skipping it would leave pharmacy_medicines readable/writable across tenants.
ALTER TABLE "pharmacy_medicines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_medicines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pharmacy_medicines"
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR "pharmacyId" = current_setting('app.pharmacy_id', true)
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR "pharmacyId" = current_setting('app.pharmacy_id', true)
    );

-- ── grn_items: medicineId becomes optional, gains a local-medicine escape hatch ─

ALTER TABLE "grn_items" ADD COLUMN "localMedicineId" TEXT;
ALTER TABLE "grn_items" ALTER COLUMN "medicineId" DROP NOT NULL;

ALTER TABLE "grn_items"
  ADD CONSTRAINT "grn_items_localMedicineId_fkey"
  FOREIGN KEY ("localMedicineId") REFERENCES "pharmacy_medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "grn_items"
  ADD CONSTRAINT "grn_items_medicine_xor_local_check"
  CHECK (("medicineId" IS NOT NULL) <> ("localMedicineId" IS NOT NULL));

CREATE INDEX "grn_items_localMedicineId_idx" ON "grn_items"("localMedicineId");

-- ── inventory: same change, plus a partial unique index for the local path ──
-- (the existing @@unique(pharmacyId, medicineId, batchNumber) already permits
-- unlimited rows with medicineId NULL — standard SQL NULL-not-equal-NULL — so
-- the local-medicine merge-on-repeat-receipt path needs its own uniqueness.)

ALTER TABLE "inventory" ADD COLUMN "localMedicineId" TEXT;
ALTER TABLE "inventory" ALTER COLUMN "medicineId" DROP NOT NULL;

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_localMedicineId_fkey"
  FOREIGN KEY ("localMedicineId") REFERENCES "pharmacy_medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_medicine_xor_local_check"
  CHECK (("medicineId" IS NOT NULL) <> ("localMedicineId" IS NOT NULL));

CREATE INDEX "inventory_pharmacyId_localMedicineId_idx" ON "inventory"("pharmacyId", "localMedicineId");

CREATE UNIQUE INDEX "inventory_pharmacy_local_medicine_batch_key"
  ON "inventory" ("pharmacyId", "localMedicineId", "batchNumber")
  WHERE "localMedicineId" IS NOT NULL;
