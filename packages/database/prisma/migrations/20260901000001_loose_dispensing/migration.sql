-- Loose ("cut strip") dispensing — Track A / MVP.
--
-- Lets a pharmacy break a pack and sell individual tablets/capsules while stock,
-- GST and the printed bill stay correct. ADDITIVE ONLY: no existing row is
-- rewritten by the schema step, every new column has a safe default, and nothing
-- changes behaviour until a pharmacy sets pharmacy_medicine_overrides.allowLooseSale.
--
--   medicines.unitsPerPack   base units in one pack (Crocin strip = 15)
--   medicines.baseUnit       TABLET | CAPSULE | ML | GM | EACH   (label only in the MVP)
--   inventory.looseUnits     loose pieces from an opened pack; always < unitsPerPack
--   invoice_items.saleUnit   PACK (default, every legacy line) | LOOSE
--   pharmacy_medicine_overrides.allowLooseSale   per-pharmacy opt-in
--
-- ── HOW TO APPLY (Supabase SQL editor, against a LIVE database) ──────────────
--   Run STEP 1 on its own first. It is metadata-only (Postgres 11+ does not
--   rewrite a table to add a column with a constant default) and finishes in
--   well under a second — UNLESS the app is holding a transaction on one of
--   these tables, in which case `lock_timeout` below makes it fail fast with
--   "canceling statement due to lock timeout" instead of hanging and blocking
--   the app. Just retry a few seconds later.
--
--   Run STEP 2 separately, afterwards. It only touches medicines that are
--   actually stocked (a few thousand rows), not the whole 250k catalogue, so it
--   is quick. It is safe to re-run and safe to skip entirely — baseUnit is a
--   label and unitsPerPack can be set per-medicine later from the admin UI.

-- ═══ STEP 1 — schema (fast, additive, safe to re-run) ═══════════════════════
SET lock_timeout = '4s';

ALTER TABLE "medicines"                  ADD COLUMN IF NOT EXISTS "unitsPerPack" INTEGER;
ALTER TABLE "medicines"                  ADD COLUMN IF NOT EXISTS "baseUnit" TEXT;
ALTER TABLE "inventory"                  ADD COLUMN IF NOT EXISTS "looseUnits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoice_items"              ADD COLUMN IF NOT EXISTS "saleUnit" TEXT NOT NULL DEFAULT 'PACK';
ALTER TABLE "pharmacy_medicine_overrides" ADD COLUMN IF NOT EXISTS "allowLooseSale" BOOLEAN NOT NULL DEFAULT false;

-- Each CHECK validates against a brand-new column whose every row holds the same
-- value (or NULL), so the scan is trivial. DROP-then-ADD keeps this re-runnable.
ALTER TABLE "medicines"     DROP CONSTRAINT IF EXISTS "medicines_unitsPerPack_positive";
ALTER TABLE "medicines"     ADD  CONSTRAINT "medicines_unitsPerPack_positive" CHECK ("unitsPerPack" IS NULL OR "unitsPerPack" > 0);
ALTER TABLE "inventory"     DROP CONSTRAINT IF EXISTS "inventory_looseUnits_nonneg";
ALTER TABLE "inventory"     ADD  CONSTRAINT "inventory_looseUnits_nonneg" CHECK ("looseUnits" >= 0);
ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_saleUnit_check";
ALTER TABLE "invoice_items" ADD  CONSTRAINT "invoice_items_saleUnit_check" CHECK ("saleUnit" IN ('PACK', 'LOOSE'));

RESET lock_timeout;

-- ═══ STEP 2 — backfill (run separately; scoped to STOCKED medicines only) ═══
-- baseUnit from the free-text form. Cosmetic, so a loose match is fine.
UPDATE "medicines" m SET "baseUnit" = CASE
    WHEN m."form" ~* 'tab'                                              THEN 'TABLET'
    WHEN m."form" ~* 'cap'                                              THEN 'CAPSULE'
    WHEN m."form" ~* 'syrup|solution|suspension|drop|liquid|elixir|oral' THEN 'ML'
    WHEN m."form" ~* 'cream|ointment|gel|powder|paste'                  THEN 'GM'
    ELSE 'EACH'
  END
WHERE m."baseUnit" IS NULL
  AND m."form" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "inventory" i WHERE i."medicineId" = m."id");

-- unitsPerPack ONLY from an unambiguous "<n>" / "<n> tablets" packSize — a bare
-- count with an optional unit word and nothing else. Anything with a second
-- number ("10x15"), a volume ("100 ml"), or words like "strip"/"bottle" is left
-- NULL for a human to set: a wrong value here misprices and miscounts a real
-- sale. Bounded 2..100 so we never assume a pack multiple of 1 or a bottle count.
UPDATE "medicines" m
SET "unitsPerPack" = (regexp_replace(m."packSize", '^\s*([0-9]+).*$', '\1'))::int
WHERE m."unitsPerPack" IS NULL
  AND m."packSize" ~* '^\s*[0-9]+\s*(tablets?|capsules?|tabs?|caps?|pcs?|pieces?|nos?|''s)?\s*$'
  AND (regexp_replace(m."packSize", '^\s*([0-9]+).*$', '\1'))::int BETWEEN 2 AND 100
  AND EXISTS (SELECT 1 FROM "inventory" i WHERE i."medicineId" = m."id");
