-- Migration: rename_tenant_to_pharmacy
-- Renames the `tenants` table to `pharmacies` and renames all `tenantId` columns
-- to `pharmacyId` across the schema. Also adds token rotation and password reset
-- fields to the `users` table.
--
-- Run: pnpm --filter @pharmacy/database prisma migrate deploy
-- Or in dev: pnpm --filter @pharmacy/database prisma migrate dev

BEGIN;

-- ── 1. Rename the tenants table ───────────────────────────────────────────────
ALTER TABLE "tenants" RENAME TO "pharmacies";

-- ── 2. Rename tenantId → pharmacyId on every affected table ──────────────────

ALTER TABLE "users"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "inventory"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "stock_reservations"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "customers"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "suppliers"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "purchase_orders"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "invoices"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "invoice_payments"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "sales_returns"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "inventory_movements"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "invoice_settings"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "audit_logs"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "uploads"
  RENAME COLUMN "tenantId" TO "pharmacyId";

ALTER TABLE "notification_logs"
  RENAME COLUMN "tenantId" TO "pharmacyId";

-- ── 3. Add new fields to users ────────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tokenVersion"                INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "passwordResetToken"          TEXT,
  ADD COLUMN IF NOT EXISTS "passwordResetTokenExpiresAt" TIMESTAMP(3);

-- Unique constraint on passwordResetToken for O(1) lookup
CREATE UNIQUE INDEX IF NOT EXISTS "users_passwordResetToken_key"
  ON "users"("passwordResetToken");

-- ── 4. Rename unique / index constraints that embed "tenant" in their name ────
-- Prisma auto-generates these names from model + field names. Rename them so
-- future `prisma migrate` diffs stay clean.

-- users: @@unique([pharmacyId, email])
ALTER INDEX IF EXISTS "users_tenantId_email_key"    RENAME TO "users_pharmacyId_email_key";
ALTER INDEX IF EXISTS "users_tenantId_role_idx"     RENAME TO "users_pharmacyId_role_idx";

-- inventory: @@unique([pharmacyId, medicineId, batchNumber])
ALTER INDEX IF EXISTS "inventory_tenantId_medicineId_batchNumber_key"
  RENAME TO "inventory_pharmacyId_medicineId_batchNumber_key";
ALTER INDEX IF EXISTS "inventory_tenantId_medicineId_idx"
  RENAME TO "inventory_pharmacyId_medicineId_idx";
ALTER INDEX IF EXISTS "inventory_tenantId_expiryDate_idx"
  RENAME TO "inventory_pharmacyId_expiryDate_idx";

-- stock_reservations
ALTER INDEX IF EXISTS "stock_reservations_tenantId_inventoryId_sessionId_key"
  RENAME TO "stock_reservations_pharmacyId_inventoryId_sessionId_key";
ALTER INDEX IF EXISTS "stock_reservations_tenantId_sessionId_idx"
  RENAME TO "stock_reservations_pharmacyId_sessionId_idx";

-- customers
ALTER INDEX IF EXISTS "customers_tenantId_phone_idx"        RENAME TO "customers_pharmacyId_phone_idx";
ALTER INDEX IF EXISTS "customers_tenantId_customerType_idx" RENAME TO "customers_pharmacyId_customerType_idx";

-- suppliers
ALTER INDEX IF EXISTS "suppliers_tenantId_idx" RENAME TO "suppliers_pharmacyId_idx";

-- purchase_orders
ALTER INDEX IF EXISTS "purchase_orders_tenantId_orderNumber_key"
  RENAME TO "purchase_orders_pharmacyId_orderNumber_key";
ALTER INDEX IF EXISTS "purchase_orders_tenantId_status_idx"
  RENAME TO "purchase_orders_pharmacyId_status_idx";

-- invoices
ALTER INDEX IF EXISTS "invoices_tenantId_invoiceNumber_key"
  RENAME TO "invoices_pharmacyId_invoiceNumber_key";
ALTER INDEX IF EXISTS "invoices_tenantId_idempotencyKey_key"
  RENAME TO "invoices_pharmacyId_idempotencyKey_key";
ALTER INDEX IF EXISTS "invoices_tenantId_createdAt_idx"   RENAME TO "invoices_pharmacyId_createdAt_idx";
ALTER INDEX IF EXISTS "invoices_tenantId_customerId_idx"  RENAME TO "invoices_pharmacyId_customerId_idx";
ALTER INDEX IF EXISTS "invoices_tenantId_status_idx"      RENAME TO "invoices_pharmacyId_status_idx";

-- invoice_payments
ALTER INDEX IF EXISTS "invoice_payments_tenantId_paidAt_idx"
  RENAME TO "invoice_payments_pharmacyId_paidAt_idx";

-- sales_returns
ALTER INDEX IF EXISTS "sales_returns_tenantId_returnNumber_key"
  RENAME TO "sales_returns_pharmacyId_returnNumber_key";
ALTER INDEX IF EXISTS "sales_returns_tenantId_idempotencyKey_key"
  RENAME TO "sales_returns_pharmacyId_idempotencyKey_key";
ALTER INDEX IF EXISTS "sales_returns_tenantId_invoiceId_idx"  RENAME TO "sales_returns_pharmacyId_invoiceId_idx";
ALTER INDEX IF EXISTS "sales_returns_tenantId_createdAt_idx"  RENAME TO "sales_returns_pharmacyId_createdAt_idx";

-- inventory_movements
ALTER INDEX IF EXISTS "inventory_movements_tenantId_inventoryId_idx"
  RENAME TO "inventory_movements_pharmacyId_inventoryId_idx";
ALTER INDEX IF EXISTS "inventory_movements_tenantId_createdAt_idx"
  RENAME TO "inventory_movements_pharmacyId_createdAt_idx";

-- invoice_settings
ALTER INDEX IF EXISTS "invoice_settings_tenantId_key" RENAME TO "invoice_settings_pharmacyId_key";

-- audit_logs
ALTER INDEX IF EXISTS "audit_logs_tenantId_createdAt_idx"        RENAME TO "audit_logs_pharmacyId_createdAt_idx";
ALTER INDEX IF EXISTS "audit_logs_tenantId_entity_entityId_idx"  RENAME TO "audit_logs_pharmacyId_entity_entityId_idx";

-- uploads
ALTER INDEX IF EXISTS "uploads_tenantId_type_idx" RENAME TO "uploads_pharmacyId_type_idx";

-- notification_logs
ALTER INDEX IF EXISTS "notification_logs_tenantId_createdAt_idx" RENAME TO "notification_logs_pharmacyId_createdAt_idx";
ALTER INDEX IF EXISTS "notification_logs_tenantId_status_idx"    RENAME TO "notification_logs_pharmacyId_status_idx";

-- ── 5. Rename foreign key constraints (optional — Postgres allows mismatched names)
-- Skipped: FK constraint names are internal; renaming them is cosmetic and risky.

COMMIT;
