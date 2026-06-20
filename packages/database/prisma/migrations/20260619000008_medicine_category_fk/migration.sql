-- Medicine.categoryId: add structured FK to product_categories.
--
-- Medicine.category (String?) is kept for backward compatibility with existing
-- data and API callers. The new categoryId column provides a proper FK-enforced
-- category reference. Having both allows a gradual migration: new medicines
-- set categoryId; old records still display using the category string.
--
-- Approach: additive — no existing data is changed, no columns are dropped.

ALTER TABLE "medicines"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

ALTER TABLE "medicines"
  ADD CONSTRAINT "medicines_categoryId_fkey"
  FOREIGN KEY ("categoryId")
  REFERENCES "product_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "medicines_categoryId_idx" ON "medicines"("categoryId");
