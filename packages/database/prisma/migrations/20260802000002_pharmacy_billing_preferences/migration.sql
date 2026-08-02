-- Billing-screen action preferences, moved from browser localStorage to the database.
--
-- They were stored ONLY in localStorage, so they were lost on a browser clear, did not
-- follow staff to another till, and were invisible to any audit trail — while sitting
-- in Account & Settings next to five sections that all persist server-side.
--
-- Nullable with no default: absent means "never configured", and the app applies its
-- built-in defaults. That keeps this backfill-free and lets a first save be told apart
-- from a deliberate reset-to-defaults.
ALTER TABLE "pharmacies" ADD COLUMN "billingPreferences" JSONB;
