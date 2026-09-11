-- Which pack size a pharmacy actually checked, and when.
--
-- WHY looseConfirmedAt IS NOT ENOUGH
--   `pharmacy_medicine_overrides."looseConfirmedAt"` is stamped the FIRST time a pharmacist ticks
--   "I've checked this against a real pack" and is never moved or cleared afterwards. It answers
--   "has anyone here ever checked a pack of this?", which is the right question for the loose-sale
--   gate it was built for and the wrong one for a trust badge: a pharmacy that confirmed 10 a
--   year ago and has since typed 60 would still read as checked.
--
--   The badge needs to know that the number billing divides by TODAY is the number somebody
--   checked. So this records the number itself alongside the moment, and re-stamps both on every
--   confirmation. Trust is then a comparison, not a memory: when the catalogue or the override
--   moves, the confirmed number stops matching and the badge comes back on its own.
--
--   Deliberately on the OVERRIDE row and never on `medicines`: one pharmacy holding a bottle
--   vouches for its own billing, not for a shared catalogue value every other pharmacy uses.
--
-- No backfill. An existing looseConfirmedAt cannot say which number it covered — the override's
-- pack size may have changed since without a confirmation — so inventing one would be exactly
-- the unearned trust this column exists to prevent. Existing rows behave as they did before.

ALTER TABLE "pharmacy_medicine_overrides" ADD COLUMN "confirmedUnitsPerPack" INTEGER;
ALTER TABLE "pharmacy_medicine_overrides" ADD COLUMN "packSizeConfirmedAt" TIMESTAMP(3);
