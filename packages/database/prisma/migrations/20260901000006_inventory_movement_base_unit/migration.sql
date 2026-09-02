-- Per-row unit tag for the stock ledger. A loose (cut-strip) movement records its
-- quantity/quantityBefore/quantityAfter in PIECES, not packs; until now the only hint
-- was a "(cut strip)" note. This column names the base unit ("TABLET" | "CAPSULE" |
-- "ML" | "GM" | "EACH") a loose row is counted in. NULL means the row is in whole
-- packs -- true for every existing row and every pack movement, so nothing is
-- redefined.
--
-- Additive, fast, safe to re-run.

SET lock_timeout = '4s';
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "baseUnit" TEXT;
RESET lock_timeout;
