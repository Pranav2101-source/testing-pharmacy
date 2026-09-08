-- ============================================================================
--  Pack-size audit — EMR prescription safety
-- ============================================================================
--
--  WHY THIS EXISTS
--  ---------------
--  An EMR prescription line arrives with a quantity the clinic already computed
--  (dose x frequency x duration). The pharmacy bills that number through the
--  dispensing engine, which reads it as a count of BASE UNITS (tablets, or mL)
--  and converts to packs via `medicines."unitsPerPack"` (or the pharmacy's
--  override, if set).
--
--  Two data problems make that conversion wrong:
--
--   1. A MEASURED medicine (syrup / drops / cream — baseUnit ML or GM) with NO
--      pack size on record. The clinic sends "30 ml"; with no mL-per-bottle the
--      engine can only read "30" as 30 whole sealed bottles. A 30 mL course
--      bills as 30 bottles.  ►►► This is the dangerous one. ◄◄◄
--      (The backend now defers such a line to manual confirmation instead of
--       billing it — see PrescriptionItem.deferAmbiguousMeasuredQuantity — but
--       fixing the catalogue is the real cure: it lets the line bill straight
--       through, correctly.)
--
--   2. A pack size that DISAGREES with the free-text `packSize` label — e.g.
--      unitsPerPack = 10 on a strip the label calls "15 tablets". A prescribed
--      15 tablets then bills as 2 strips (or 15 loose), never 1 strip of 15.
--
--  HOW TO RUN
--  ----------
--    psql "$DATABASE_URL" -f packages/database/scripts/audit-pack-size-emr-safety.sql
--
--  Every query is READ-ONLY. Nothing here changes data.
--
--  Column notes: Prisma maps these model fields to quoted, case-sensitive
--  Postgres columns — "unitsPerPack", "baseUnit", "packSize", "isActive".
-- ============================================================================


-- A medicine's effective base unit: the stored one, else inferred from `form`,
-- mirroring com.checkup.pharmacy.common.util.BaseUnits.resolve.
CREATE OR REPLACE TEMP VIEW _med_base_unit AS
SELECT
    m.*,
    CASE
        WHEN m."baseUnit" IS NOT NULL AND btrim(m."baseUnit") <> ''
            THEN upper(btrim(m."baseUnit"))
        WHEN m.form IS NULL OR btrim(m.form) = '' THEN NULL
        WHEN lower(m.form) LIKE '%tab%' THEN 'TABLET'
        WHEN lower(m.form) LIKE '%cap%' THEN 'CAPSULE'
        WHEN lower(m.form) ~ '(syrup|solution|suspension|drop|liquid|elixir|oral)' THEN 'ML'
        WHEN lower(m.form) ~ '(cream|ointment|gel|powder|paste)' THEN 'GM'
        ELSE 'EACH'
    END AS resolved_base_unit,
    -- The first mL/g figure named in the free-text pack size ("100 ml bottle" -> 100),
    -- approximating com.checkup.pharmacy.common.util.PackSizeGuard.parseMeasuredSize.
    NULLIF(substring(m."packSize" from '(\d{1,6})\s*(?:ml|millilitres?|milliliters?|gm|grams?|g)(?![a-z])'), '')::int
        AS pack_size_measured_number,
    -- The first plain integer in the pack size ("10 tablets" / "1x15" -> 10 / 1);
    -- a rough label figure for the countable-mismatch check below.
    NULLIF(substring(m."packSize" from '(\d{1,6})'), '')::int AS pack_size_first_number
FROM medicines m;


\echo ''
\echo '=== 1. CRITICAL: measured medicines (mL/g) with NO pack size — clinic mL bills as bottles ==='
\echo '    Fix: set medicines."unitsPerPack" to the mL/g in one sealed bottle/tube,'
\echo '    or (per pharmacy) add a pharmacy_medicine_overrides row with "unitsPerPack".'
\echo ''
SELECT
    b.id                AS medicine_id,
    b.name,
    b.form,
    b.unit              AS pack_word,
    b."packSize"        AS pack_size_label,
    b.resolved_base_unit,
    b."unitsPerPack"    AS catalogue_units_per_pack,
    b.pack_size_measured_number AS suggested_units_per_pack,  -- from the label, when it names a size
    ov.override_count   AS pharmacy_overrides_with_pack_size
FROM _med_base_unit b
LEFT JOIN (
    SELECT "medicineId", count(*) AS override_count
    FROM pharmacy_medicine_overrides
    WHERE "unitsPerPack" IS NOT NULL
    GROUP BY "medicineId"
) ov ON ov."medicineId" = b.id
WHERE b."isActive"
  AND b.resolved_base_unit IN ('ML', 'GM')
  AND b."unitsPerPack" IS NULL
ORDER BY (ov.override_count IS NOT NULL), b.name;


\echo ''
\echo '=== 2. CONTRADICTORY: measured medicines whose "unitsPerPack" != the mL/g in the label ==='
\echo '    Fix: make them match. If the medicine genuinely comes in several sizes,'
\echo '    hold each size as its own medicine (its own MRP / barcode / stock).'
\echo '    See docs/V2-PACK-VARIANTS.md.'
\echo ''
SELECT
    b.id             AS medicine_id,
    b.name,
    b.resolved_base_unit,
    b."packSize"     AS pack_size_label,
    b.pack_size_measured_number AS label_says,
    b."unitsPerPack" AS units_per_pack_says
FROM _med_base_unit b
WHERE b."isActive"
  AND b.resolved_base_unit IN ('ML', 'GM')
  AND b."unitsPerPack" IS NOT NULL
  AND b.pack_size_measured_number IS NOT NULL
  AND b.pack_size_measured_number <> b."unitsPerPack"
ORDER BY b.name;


\echo ''
\echo '=== 3. ADVISORY: countable medicines (tablet/capsule) whose "unitsPerPack" != the label ==='
\echo '    e.g. a "15 tablets" strip recorded as unitsPerPack = 10 — a prescribed 15'
\echo '    then bills as 2 strips or 15 loose, never 1 strip of 15. Heuristic (free-text'
\echo '    label), so eyeball each before changing anything.'
\echo ''
SELECT
    b.id             AS medicine_id,
    b.name,
    b.resolved_base_unit,
    b."packSize"     AS pack_size_label,
    b.pack_size_first_number AS label_first_number,
    b."unitsPerPack" AS units_per_pack_says
FROM _med_base_unit b
WHERE b."isActive"
  AND b.resolved_base_unit IN ('TABLET', 'CAPSULE')
  AND b."unitsPerPack" IS NOT NULL
  AND b.pack_size_first_number IS NOT NULL
  AND b.pack_size_first_number > 1
  AND b.pack_size_first_number <> b."unitsPerPack"
ORDER BY b.name;


\echo ''
\echo '=== 4. ADVISORY: pharmacy pack-size overrides that disagree with the catalogue label ==='
\echo ''
SELECT
    o."pharmacyId",
    p.name           AS pharmacy_name,
    o."medicineId",
    b.name           AS medicine_name,
    b.resolved_base_unit,
    b."packSize"     AS catalogue_pack_size_label,
    coalesce(b.pack_size_measured_number, b.pack_size_first_number) AS label_number,
    o."unitsPerPack" AS override_units_per_pack
FROM pharmacy_medicine_overrides o
JOIN _med_base_unit b ON b.id = o."medicineId"
LEFT JOIN pharmacies p ON p.id = o."pharmacyId"
WHERE o."unitsPerPack" IS NOT NULL
  AND coalesce(b.pack_size_measured_number, b.pack_size_first_number) IS NOT NULL
  AND coalesce(b.pack_size_measured_number, b.pack_size_first_number) <> o."unitsPerPack"
ORDER BY pharmacy_name, medicine_name;


\echo ''
\echo '=== 5. COUNT: unconfirmed measured prescription lines already sitting in the DB ==='
\echo '    Lines the new guard (or a genuine "as directed") left for a pharmacist to settle.'
\echo '    High numbers here point back at query 1.'
\echo ''
SELECT
    count(*) FILTER (WHERE pi.quantity <= 0) AS unconfirmed_lines,
    count(*) FILTER (WHERE pi.quantity <= 0
                       AND b.resolved_base_unit IN ('ML', 'GM')) AS unconfirmed_measured_lines
FROM prescription_items pi
LEFT JOIN _med_base_unit b ON b.id = pi."medicineId";


DROP VIEW _med_base_unit;
