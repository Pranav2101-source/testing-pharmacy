-- Extends the medicine catalogue search to the `composition` column.
--
-- `composition` (e.g. "Paracetamol 500mg + Caffeine 30mg") is populated for
-- essentially every catalogue row by the bulk import (see
-- import-medicines.ts's short_composition1/2 concatenation), but
-- MedicineRepository.quickSearch never matched against it — a pharmacist
-- searching by what's printed on the strip instead of the brand name got
-- nothing, even though the data was sitting right there.
--
-- Same reasoning as 20260818000001_medicine_catalogue_trgm_search: quickSearch
-- and the new MedicineRepository.fuzzySearch both need to match this column
-- with a leading-wildcard LIKE / trigram similarity, which requires its own
-- GIN + pg_trgm index over LOWER(composition) — a plain B-tree (or none at
-- all) would force a sequential scan of the full 250k-row catalogue on every
-- keystroke, exactly the problem the earlier migration fixed for
-- name/genericName/manufacturer.
--
-- No B-tree equality index is added here (unlike that migration's
-- medicines_name_lower_idx): nothing does an exact LOWER(composition) = ?
-- lookup today.

CREATE INDEX IF NOT EXISTS "medicines_composition_lower_trgm_idx"
  ON "medicines" USING GIN (LOWER("composition") gin_trgm_ops);
