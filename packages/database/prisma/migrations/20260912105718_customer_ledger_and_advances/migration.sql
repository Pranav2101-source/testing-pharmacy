-- Customer ledger (khata) + advance balances.
--
-- HAND-WRITTEN, deliberately. `prisma migrate dev` generated 205 lines for these
-- ~40: it also wanted to drop and recreate ~20 foreign keys across the schema,
-- DROP INDEX "invoices_doctorId_idx" (created by 20260612000003, never declared
-- in schema.prisma), and rewrite column types on prescriptions,
-- prescription_items, batch_recalls and migration_sessions. That is residual
-- drift from the pre-20260908 `db push` era: the reconcile migration converged
-- prod against schema.prisma, but never converged a REPLAY of the migration
-- folder against schema.prisma, so every `migrate dev` re-proposes it.
--
-- None of that churn belongs in a feature migration. Converging the folder is
-- its own deliberate migration, reviewed on its own. Everything below is only
-- what the customer-ledger feature needs.
--
-- Additive and defaulted throughout: no existing row changes value, no column
-- becomes non-nullable, nothing is dropped. Safe to deploy AHEAD of the Java
-- code that reads it — Hibernate runs ddl-auto: validate, which tolerates
-- columns and tables no entity maps yet.

-- ─── Enum ────────────────────────────────────────────────────────────────────

CREATE TYPE "CustomerLedgerEntryType" AS ENUM (
    'OPENING',
    'SALE',
    'PAYMENT',
    'ADVANCE',
    'ADVANCE_APPLIED',
    'RETURN_CREDIT',
    'REFUND',
    'WRITE_OFF'
);

-- ─── Cached balances ─────────────────────────────────────────────────────────
-- Both are caches of a SUM over customer_ledger_entries, kept so the hot path
-- (billing, receivables list, bill list) needs no aggregate. The ledger is the
-- authority; these are what make it cheap to read.

ALTER TABLE "customers" ADD COLUMN "advanceBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "invoices" ADD COLUMN "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ─── Ledger table ────────────────────────────────────────────────────────────

CREATE TABLE "customer_ledger_entries" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CustomerLedgerEntryType" NOT NULL,
    -- NULL for entries auto-posted as a side effect of a bill; set only where the
    -- entry IS a numbered document handed to the customer. NULLs are distinct in
    -- Postgres, so the unique index below tolerates any number of them.
    "entryNumber" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "duesDelta" DECIMAL(12,2) NOT NULL,
    "advanceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "duesBalanceAfter" DECIMAL(12,2) NOT NULL,
    "advanceBalanceAfter" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "salesReturnId" TEXT,
    "paymentMode" "PaymentMode",
    "reference" TEXT,
    "notes" TEXT,
    -- Business date, backdatable by the pharmacist. NOT a sort key:
    -- CURRENT_TIMESTAMP is transaction-START time, so two entries posted by one
    -- bill (SALE + ADVANCE_APPLIED) share it exactly.
    "entryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Total order for statement printing. Verified necessary: with identical
    -- entryAt values the statement fell back to ordering by cuid — alphabetical,
    -- not chronological — which printed the SALE after the payment that settled
    -- it and made every closing balance on the khata nonsense.
    "seq" BIGSERIAL NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_ledger_entries_pharmacyId_customerId_seq_idx"
    ON "customer_ledger_entries"("pharmacyId", "customerId", "seq");
CREATE INDEX "customer_ledger_entries_pharmacyId_customerId_type_idx"
    ON "customer_ledger_entries"("pharmacyId", "customerId", "type");
CREATE INDEX "customer_ledger_entries_pharmacyId_type_entryAt_idx"
    ON "customer_ledger_entries"("pharmacyId", "type", "entryAt");
CREATE INDEX "customer_ledger_entries_invoiceId_idx"
    ON "customer_ledger_entries"("invoiceId");
CREATE INDEX "customer_ledger_entries_salesReturnId_idx"
    ON "customer_ledger_entries"("salesReturnId");
CREATE UNIQUE INDEX "customer_ledger_entries_pharmacyId_type_entryNumber_key"
    ON "customer_ledger_entries"("pharmacyId", "type", "entryNumber");

-- RESTRICT on customerId and createdBy, matching supplier_ledger_entries: a
-- customer or staff member with ledger history must not be hard-deleted out from
-- under it (customers are soft-deleted via deletedAt anyway). SET NULL on the
-- invoice/return links so cancelling the document never deletes the money trail.
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_salesReturnId_fkey"
    FOREIGN KEY ("salesReturnId") REFERENCES "sales_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Sequence grant ─────────────────────────────────────────────────────────
-- The BIGSERIAL above creates public.customer_ledger_entries_seq_seq — the FIRST
-- AND ONLY sequence in this schema; every other table keys off a cuid text PK.
-- That makes it a new object class for the grant story, and INSERT fails with
-- "permission denied for sequence" for any role that is not the owner. Verified:
-- a non-superuser probe with full table DML still could not insert without this.
--
-- bootstrap-roles.sql sets ALTER DEFAULT PRIVILEGES ... ON SEQUENCES, which would
-- cover it on a managed instance — but only if that ran BEFORE this migration
-- created the sequence. Granting explicitly removes the ordering dependency.
-- Guarded on role existence so this is a no-op where app_user is not provisioned.
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT USAGE, SELECT ON SEQUENCE public.customer_ledger_entries_seq_seq TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_ledger_entries TO app_user;
    END IF;
END
$grant$;

-- ─── Row-Level Security ──────────────────────────────────────────────────────
-- Mandatory, not optional. 20260719000001 enabled fail-closed tenant isolation on
-- every table carrying a pharmacyId; a new tenant table added without it would be
-- the ONLY unprotected one in the schema, and it would hold every customer's
-- outstanding balance. Same GUCs, same fail-closed semantics, same FORCE (the app
-- connects to Supabase as the table owner, which is exempt from its own policies
-- without it). See that migration's header for the full rationale.
--
-- No cross-tenant bypass branch beyond app.bypass_rls: unlike pack_size_signals,
-- nothing here is ever read across pharmacies.

ALTER TABLE public."customer_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."customer_ledger_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."customer_ledger_entries";
CREATE POLICY tenant_isolation ON public."customer_ledger_entries"
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR "pharmacyId" = current_setting('app.pharmacy_id', true)
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR "pharmacyId" = current_setting('app.pharmacy_id', true)
    );
