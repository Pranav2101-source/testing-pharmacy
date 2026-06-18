-- Migration: Row-Level Security (defense-in-depth tenant isolation)
--
-- Approach:
--   • Every pharmacy-scoped table gets RLS enabled + a PERMISSIVE policy.
--   • The policy enforces pharmacyId = current_setting('app.current_pharmacy_id', true)
--     ONLY when that setting is non-empty.  When the setting is absent (migrations,
--     worker jobs, admin scripts running as the Supabase postgres role) access is
--     unrestricted — intentional, as those operations are already privileged.
--   • Application code sets the session variable via:
--       SELECT set_config('app.current_pharmacy_id', '<id>', true)
--     at the start of each Prisma interactive transaction (see withTenant utility).
--   • Global tables (medicines, brands, product_categories, ticket_categories,
--     support_agents) are shared across pharmacies; no RLS applied.
--
-- NOTE: FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner
-- (postgres / service_role). Without it, the superuser bypasses RLS entirely.

-- ─── Helper macro (inline — Postgres doesn't have stored macros, so we repeat) ─

-- Policy expression used for all "pharmacyId" tables:
--   allow if context not set (empty/null) OR pharmacyId matches
-- This is a PERMISSIVE policy, so Prisma's own WHERE filters remain the
-- primary guard; RLS is the secondary catch for bugs or direct-DB access.

-- ─── pharmacies ──────────────────────────────────────────────────────────────

ALTER TABLE "pharmacies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacies" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pharmacies_tenant_isolation" ON "pharmacies"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR id = current_setting('app.current_pharmacy_id', true)
  );

-- ─── users ────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY "users_tenant_isolation" ON "users"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── customers ────────────────────────────────────────────────────────────────

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;

CREATE POLICY "customers_tenant_isolation" ON "customers"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── suppliers ────────────────────────────────────────────────────────────────

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_tenant_isolation" ON "suppliers"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── inventory ────────────────────────────────────────────────────────────────

ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory" FORCE ROW LEVEL SECURITY;

CREATE POLICY "inventory_tenant_isolation" ON "inventory"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── stock_reservations ───────────────────────────────────────────────────────

ALTER TABLE "stock_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_reservations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "stock_reservations_tenant_isolation" ON "stock_reservations"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── purchase_orders ─────────────────────────────────────────────────────────

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY "purchase_orders_tenant_isolation" ON "purchase_orders"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── purchase_order_items ────────────────────────────────────────────────────

ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "purchase_order_items_tenant_isolation" ON "purchase_order_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── goods_receipt_notes ─────────────────────────────────────────────────────

ALTER TABLE "goods_receipt_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_notes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "goods_receipt_notes_tenant_isolation" ON "goods_receipt_notes"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── grn_items ────────────────────────────────────────────────────────────────

ALTER TABLE "grn_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grn_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "grn_items_tenant_isolation" ON "grn_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── invoices ─────────────────────────────────────────────────────────────────

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant_isolation" ON "invoices"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── invoice_items ────────────────────────────────────────────────────────────

ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoice_items_tenant_isolation" ON "invoice_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── invoice_payments ────────────────────────────────────────────────────────

ALTER TABLE "invoice_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoice_payments_tenant_isolation" ON "invoice_payments"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── sales_returns ────────────────────────────────────────────────────────────

ALTER TABLE "sales_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_returns" FORCE ROW LEVEL SECURITY;

CREATE POLICY "sales_returns_tenant_isolation" ON "sales_returns"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── sales_return_items ───────────────────────────────────────────────────────

ALTER TABLE "sales_return_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_return_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "sales_return_items_tenant_isolation" ON "sales_return_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── inventory_movements ─────────────────────────────────────────────────────

ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;

CREATE POLICY "inventory_movements_tenant_isolation" ON "inventory_movements"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── supplier_returns ─────────────────────────────────────────────────────────

ALTER TABLE "supplier_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_returns" FORCE ROW LEVEL SECURITY;

CREATE POLICY "supplier_returns_tenant_isolation" ON "supplier_returns"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── supplier_return_items ────────────────────────────────────────────────────

ALTER TABLE "supplier_return_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_return_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "supplier_return_items_tenant_isolation" ON "supplier_return_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── supplier_payments ────────────────────────────────────────────────────────

ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "supplier_payments_tenant_isolation" ON "supplier_payments"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── supplier_credit_notes ────────────────────────────────────────────────────

ALTER TABLE "supplier_credit_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_credit_notes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "supplier_credit_notes_tenant_isolation" ON "supplier_credit_notes"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── quotations ───────────────────────────────────────────────────────────────

ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "quotations_tenant_isolation" ON "quotations"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── quotation_items ──────────────────────────────────────────────────────────

ALTER TABLE "quotation_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotation_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "quotation_items_tenant_isolation" ON "quotation_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── racks ────────────────────────────────────────────────────────────────────

ALTER TABLE "racks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "racks" FORCE ROW LEVEL SECURITY;

CREATE POLICY "racks_tenant_isolation" ON "racks"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── shelves ──────────────────────────────────────────────────────────────────

ALTER TABLE "shelves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shelves" FORCE ROW LEVEL SECURITY;

CREATE POLICY "shelves_tenant_isolation" ON "shelves"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── stock_audit_sessions ─────────────────────────────────────────────────────

ALTER TABLE "stock_audit_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_audit_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "stock_audit_sessions_tenant_isolation" ON "stock_audit_sessions"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── stock_audit_items ────────────────────────────────────────────────────────

ALTER TABLE "stock_audit_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_audit_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "stock_audit_items_tenant_isolation" ON "stock_audit_items"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── calendar_events ──────────────────────────────────────────────────────────

ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_tenant_isolation" ON "calendar_events"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── uploads ──────────────────────────────────────────────────────────────────

ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uploads" FORCE ROW LEVEL SECURITY;

CREATE POLICY "uploads_tenant_isolation" ON "uploads"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── audit_logs ───────────────────────────────────────────────────────────────

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── notification_logs ────────────────────────────────────────────────────────

ALTER TABLE "notification_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "notification_logs_tenant_isolation" ON "notification_logs"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── invoice_settings ─────────────────────────────────────────────────────────

ALTER TABLE "invoice_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoice_settings_tenant_isolation" ON "invoice_settings"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── pharmacy_medicine_overrides ──────────────────────────────────────────────

ALTER TABLE "pharmacy_medicine_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_medicine_overrides" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pharmacy_medicine_overrides_tenant_isolation" ON "pharmacy_medicine_overrides"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── doctors ──────────────────────────────────────────────────────────────────

ALTER TABLE "doctors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctors" FORCE ROW LEVEL SECURITY;

CREATE POLICY "doctors_tenant_isolation" ON "doctors"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── cash_closures ────────────────────────────────────────────────────────────

ALTER TABLE "cash_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_closures" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cash_closures_tenant_isolation" ON "cash_closures"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── document_sequences ───────────────────────────────────────────────────────

ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "document_sequences_tenant_isolation" ON "document_sequences"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── support_tickets ──────────────────────────────────────────────────────────
-- Support tickets are cross-tenant by nature (PLATFORM_ADMIN sees all).
-- RLS still prevents a pharmacy user from reading another pharmacy's tickets
-- when the context is set; PLATFORM_ADMIN operations run without a context.

ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_tickets" FORCE ROW LEVEL SECURITY;

CREATE POLICY "support_tickets_tenant_isolation" ON "support_tickets"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── ticket_messages ──────────────────────────────────────────────────────────

ALTER TABLE "ticket_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ticket_messages_tenant_isolation" ON "ticket_messages"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );

-- ─── ticket_attachments ───────────────────────────────────────────────────────

ALTER TABLE "ticket_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_attachments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ticket_attachments_tenant_isolation" ON "ticket_attachments"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.current_pharmacy_id', true) IS NULL
    OR current_setting('app.current_pharmacy_id', true) = ''
    OR "pharmacyId" = current_setting('app.current_pharmacy_id', true)
  );
