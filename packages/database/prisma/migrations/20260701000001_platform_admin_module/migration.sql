-- Platform Admin module: tenant management, subscriptions/billing, audit log
-- viewer, and support ticket SLA/priority. Backs the PR merged at 3b14651
-- ("dev/divyansh" branch) whose schema.prisma changes had never been turned
-- into a migration — this file closes that gap. Additive only; no existing
-- table's data is touched beyond the new nullable/defaulted columns below.

-- ── New enums ───────────────────────────────────────────────────────────────

CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED', 'PENDING', 'TRIAL', 'EXPIRED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'PAUSED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('PAID', 'PENDING', 'OVERDUE', 'CANCELLED', 'REFUNDED');
CREATE TYPE "AuditModule" AS ENUM ('AUTH', 'TENANTS', 'SUBSCRIPTIONS', 'SUPPORT', 'SETTINGS', 'SYSTEM', 'ANALYTICS', 'AUDIT', 'BILLING', 'INVENTORY');
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "TicketSLA" AS ENUM ('SLA_4H', 'SLA_8H', 'SLA_24H', 'SLA_48H', 'SLA_72H', 'SLA_3D');

-- ── pharmacies: tenant code + status ────────────────────────────────────────

ALTER TABLE "pharmacies" ADD COLUMN "tenantCode" TEXT;
ALTER TABLE "pharmacies" ADD COLUMN "tenantStatus" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE UNIQUE INDEX "pharmacies_tenantCode_key" ON "pharmacies"("tenantCode");

-- ── audit_logs: platform audit-center columns ───────────────────────────────
-- pharmacyId/userId become nullable — platform-level actions (e.g. tenant
-- import, cross-tenant bulk actions) have no single pharmacy or acting
-- pharmacy-user to attach to.

ALTER TABLE "audit_logs" ADD COLUMN "module"       "AuditModule"  NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE "audit_logs" ADD COLUMN "severity"     "AuditSeverity" NOT NULL DEFAULT 'INFO';
ALTER TABLE "audit_logs" ADD COLUMN "status"       "AuditStatus"  NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "audit_logs" ADD COLUMN "userEmail"    TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "resourceName" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "requestId"    TEXT;
ALTER TABLE "audit_logs" ALTER COLUMN "pharmacyId" DROP NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "userId"     DROP NOT NULL;

CREATE INDEX "audit_logs_module_severity_createdAt_idx" ON "audit_logs"("module", "severity", "createdAt");
CREATE INDEX "audit_logs_status_createdAt_idx"          ON "audit_logs"("status", "createdAt");
CREATE INDEX "audit_logs_requestId_idx"                 ON "audit_logs"("requestId");
CREATE INDEX "audit_logs_entity_entityId_createdAt_idx" ON "audit_logs"("entity", "entityId", "createdAt");

-- ── support_tickets: priority + SLA ──────────────────────────────────────────

ALTER TABLE "support_tickets" ADD COLUMN "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "support_tickets" ADD COLUMN "sla"      "TicketSLA";
ALTER TABLE "support_tickets" ADD COLUMN "dueDate"  TIMESTAMP(3);

-- ── ticket_sequences: global counter for ticket numbering (no pharmacyId — mirrors medicines/brands as a shared, non-tenant table) ──

CREATE TABLE "ticket_sequences" (
    "id"      TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ticket_sequences_pkey" PRIMARY KEY ("id")
);

-- ── subscriptions: one per pharmacy ──────────────────────────────────────────

CREATE TABLE "subscriptions" (
    "id"            TEXT NOT NULL,
    "pharmacyId"    TEXT NOT NULL,
    "planName"      TEXT NOT NULL DEFAULT 'Free',
    "status"        "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCycle"  TEXT NOT NULL DEFAULT 'MONTHLY',
    "amount"        DOUBLE PRECISION,
    "autoRenew"     BOOLEAN NOT NULL DEFAULT true,
    "validUntil"    TIMESTAMP(3) NOT NULL,
    "trialEndsAt"   TIMESTAMP(3),
    "pausedAt"      TIMESTAMP(3),
    "cancelledAt"   TIMESTAMP(3),
    "discount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "couponCode"    TEXT,
    "creditBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_pharmacyId_key" ON "subscriptions"("pharmacyId");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ── subscription_invoices ────────────────────────────────────────────────────

CREATE TABLE "subscription_invoices" (
    "id"             TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "pharmacyId"     TEXT NOT NULL,
    "invoiceNumber"  TEXT NOT NULL,
    "amount"         DOUBLE PRECISION NOT NULL,
    "tax"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total"          DOUBLE PRECISION NOT NULL,
    "couponCode"     TEXT,
    "status"         "InvoicePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate"        TIMESTAMP(3) NOT NULL,
    "paidAt"         TIMESTAMP(3),
    "gstinPharmacy"  TEXT,
    "gstinPlatform"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_invoices_invoiceNumber_key" ON "subscription_invoices"("invoiceNumber");
CREATE INDEX "subscription_invoices_pharmacyId_idx" ON "subscription_invoices"("pharmacyId");
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_invoices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscription_invoices_tenant_isolation" ON "subscription_invoices"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ── subscription_audit_logs ──────────────────────────────────────────────────
-- No direct pharmacyId column (only subscriptionId), so this can't use the
-- same simple RLS policy as the tables above without denormalizing pharmacyId
-- onto it — deliberately left without RLS for now, same as this repo's
-- existing child-record tables that only carry a parent FK (e.g.
-- audit_logs itself pre-dates per-row RLS). Only PLATFORM_ADMIN routes read
-- this table today.

CREATE TABLE "subscription_audit_logs" (
    "id"             TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "action"         TEXT NOT NULL,
    "oldValue"       TEXT,
    "newValue"       TEXT,
    "performedBy"    TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_audit_logs_subscriptionId_idx" ON "subscription_audit_logs"("subscriptionId");
ALTER TABLE "subscription_audit_logs" ADD CONSTRAINT "subscription_audit_logs_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── tenant_settings: one per pharmacy ────────────────────────────────────────

CREATE TABLE "tenant_settings" (
    "id"                  TEXT NOT NULL,
    "pharmacyId"          TEXT NOT NULL,
    "doctorLimit"         INTEGER NOT NULL DEFAULT 5,
    "staffLimit"          INTEGER NOT NULL DEFAULT 5,
    "patientLimit"        INTEGER NOT NULL DEFAULT 500,
    "storageLimit"        INTEGER NOT NULL DEFAULT 1024,
    "enableBilling"       BOOLEAN NOT NULL DEFAULT true,
    "enableInventory"     BOOLEAN NOT NULL DEFAULT true,
    "enableEmr"           BOOLEAN NOT NULL DEFAULT false,
    "enableCrm"           BOOLEAN NOT NULL DEFAULT false,
    "enableWhatsapp"      BOOLEAN NOT NULL DEFAULT false,
    "enableSms"           BOOLEAN NOT NULL DEFAULT false,
    "enableApiAccess"     BOOLEAN NOT NULL DEFAULT false,
    "enableOnlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_settings_pharmacyId_key" ON "tenant_settings"("pharmacyId");
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings_tenant_isolation" ON "tenant_settings"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ── Missing indexes on hot filter/sort columns (subscriptions.service.ts and analytics.service.ts) ──

CREATE INDEX "subscriptions_status_idx"     ON "subscriptions"("status");
CREATE INDEX "subscriptions_validUntil_idx" ON "subscriptions"("validUntil");
CREATE INDEX "support_tickets_priority_idx" ON "support_tickets"("priority");
