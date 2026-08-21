-- Make medicine search survive a 250k-row catalogue.
--
-- WHAT IS WRONG
-- `MedicineRepository.search` and `MedicineRepository.quickSearch` both match with
--   LOWER(col) LIKE LOWER(CONCAT('%', :q, '%'))
-- across name, genericName and manufacturer. A LIKE pattern with a LEADING wildcard
-- cannot use a B-tree, so every index we already have on these columns
-- ("medicines_name_idx", "medicines_genericName_idx", "medicines_manufacturer_idx")
-- is dead weight for this query. Postgres has no choice but a sequential scan that
-- calls LOWER() on three columns of every row.
--
-- That is invisible today because the catalogue is small. It stops being invisible
-- the moment the bulk medicine import lands ~250k rows: quickSearch backs the billing
-- combobox and fires on keystrokes, so every character typed while making a bill would
-- scan the whole catalogue three times over.
--
-- WHY GIN + pg_trgm
-- The trigram operator class serves LIKE '%...%' directly — the leading wildcard is
-- exactly the case it exists for. Postgres finds the rows whose trigrams overlap the
-- search term and rechecks only those, instead of touching all 250k.
--
-- The indexes are on LOWER(col), NOT on the bare column. An index on "name"
-- gin_trgm_ops would not be used here: the planner only matches an expression index
-- when the indexed expression is the one in the query, and the query lowercases first.
-- This is the same trap noted for functional indexes elsewhere in the schema.
--
-- ORDER OF OPERATIONS
-- Apply this AFTER the bulk import, not before. Building a GIN index once over a
-- finished table is cheaper than paying GIN maintenance on all 250k inserts. It is
-- safe to apply first — the import just runs slower — so the migration does not
-- depend on the ordering, but the fast path is import → migrate.
--
-- The genericName and manufacturer indexes cover NULLs for free: GIN simply omits
-- them, and a NULL column can never satisfy a LIKE predicate anyway.

-- Plain CREATE EXTENSION (no WITH SCHEMA) so this migration also applies against the
-- vanilla Postgres used by the integration-test container. On Supabase, pg_trgm is
-- already present in the "extensions" schema and IF NOT EXISTS makes this a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "medicines_name_lower_trgm_idx"
  ON "medicines" USING GIN (LOWER("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "medicines_genericName_lower_trgm_idx"
  ON "medicines" USING GIN (LOWER("genericName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "medicines_manufacturer_lower_trgm_idx"
  ON "medicines" USING GIN (LOWER("manufacturer") gin_trgm_ops);

-- ── Equality lookups need a B-tree, not the GIN above ───────────────────────────
--
-- `MedicineRepository.findActiveByLowerNameIn` matches LOWER("name") IN (...), and
-- `findAlternatives` matches LOWER("genericName") = ?. gin_trgm_ops implements the LIKE
-- and similarity operators only — it does not answer plain equality — so the trigram
-- indexes above do nothing for these two. They need ordinary B-trees over the same
-- expression, and for the same reason as above it must be the LOWER() expression and
-- not the bare column.
--
-- Both callers get hot at catalogue scale: findActiveByLowerNameIn is how
-- MigrationService resolves an entire imported CSV's medicine names to catalogue rows,
-- and how MedicineService resolves names outside the migration flow.

CREATE INDEX IF NOT EXISTS "medicines_name_lower_idx"
  ON "medicines" (LOWER("name"));

CREATE INDEX IF NOT EXISTS "medicines_genericName_lower_idx"
  ON "medicines" (LOWER("genericName"));
