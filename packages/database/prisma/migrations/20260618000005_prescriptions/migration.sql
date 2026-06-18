-- Migration: 20260618000005_prescriptions
-- Adds structured prescription tracking (D&C Act compliance for Schedule H/H1/X).
-- Also adds missing purchase_order_items(purchaseOrderId) index.

-- ── Prescriptions ─────────────────────────────────────────────────────────────

CREATE TYPE "PrescriptionStatus" AS ENUM ('ACTIVE', 'PARTIAL', 'DISPENSED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "prescriptions" (
  "id"                 TEXT         NOT NULL,
  "pharmacyId"         TEXT         NOT NULL,
  "prescriptionNumber" TEXT         NOT NULL,
  "doctorId"           TEXT,
  "doctorName"         TEXT         NOT NULL,
  "doctorRegNo"        TEXT,
  "doctorPhone"        TEXT,
  "patientName"        TEXT         NOT NULL,
  "patientAge"         INTEGER,
  "patientPhone"       TEXT,
  "patientGender"      TEXT,
  "uploadId"           TEXT,
  "prescribedDate"     TIMESTAMPTZ,
  "validUntil"         TIMESTAMPTZ,
  "status"             "PrescriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"              TEXT,
  "createdAt"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prescriptions_pharmacyId_prescriptionNumber_key" UNIQUE ("pharmacyId", "prescriptionNumber"),
  CONSTRAINT "prescriptions_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE,
  CONSTRAINT "prescriptions_doctorId_fkey"
    FOREIGN KEY ("doctorId")   REFERENCES "doctors"("id")    ON DELETE SET NULL,
  CONSTRAINT "prescriptions_uploadId_fkey"
    FOREIGN KEY ("uploadId")   REFERENCES "uploads"("id")    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "prescriptions_pharmacyId_status_idx"
  ON "prescriptions" ("pharmacyId", "status");

CREATE INDEX IF NOT EXISTS "prescriptions_pharmacyId_doctorId_idx"
  ON "prescriptions" ("pharmacyId", "doctorId");

CREATE INDEX IF NOT EXISTS "prescriptions_pharmacyId_createdAt_idx"
  ON "prescriptions" ("pharmacyId", "createdAt");

-- ── Prescription items ────────────────────────────────────────────────────────

CREATE TABLE "prescription_items" (
  "id"             TEXT    NOT NULL,
  "pharmacyId"     TEXT    NOT NULL,
  "prescriptionId" TEXT    NOT NULL,
  "medicineName"   TEXT    NOT NULL,
  "medicineId"     TEXT,
  "schedule"       TEXT,
  "quantity"       INTEGER NOT NULL,
  "dispensedQty"   INTEGER NOT NULL DEFAULT 0,
  "dosage"         TEXT,
  "duration"       TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prescription_items_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId")     REFERENCES "pharmacies"("id")      ON DELETE CASCADE,
  CONSTRAINT "prescription_items_prescriptionId_fkey"
    FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id")   ON DELETE CASCADE,
  CONSTRAINT "prescription_items_medicineId_fkey"
    FOREIGN KEY ("medicineId")     REFERENCES "medicines"("id")        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "prescription_items_pharmacyId_idx"
  ON "prescription_items" ("pharmacyId");

CREATE INDEX IF NOT EXISTS "prescription_items_prescriptionId_idx"
  ON "prescription_items" ("prescriptionId");

-- ── Rewire invoices.prescriptionId → prescriptions ────────────────────────────
-- Previously pointed at uploads.id; now points at prescriptions.id.
-- Null out existing values since they reference upload IDs, not prescription IDs.

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_prescriptionId_fkey";

UPDATE "invoices" SET "prescriptionId" = NULL WHERE "prescriptionId" IS NOT NULL;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL;

-- ── RLS policies for new tables ───────────────────────────────────────────────

ALTER TABLE "prescriptions"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescription_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "prescriptions"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "prescription_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "prescriptions_tenant_isolation" ON "prescriptions"
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

CREATE POLICY "prescription_items_tenant_isolation" ON "prescription_items"
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- Grant access to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON "prescriptions"      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "prescription_items" TO app_user;

-- ── Missing PO items index ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "purchase_order_items_purchaseOrderId_idx"
  ON "purchase_order_items" ("purchaseOrderId");
