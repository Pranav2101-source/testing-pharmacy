-- Two hot-path queries in the EMR integration have no supporting index today. Neither is
-- slow yet — prescription history is still small — but both are worth fixing proactively
-- rather than after a pharmacist notices, the same reasoning already applied to the medicine
-- catalogue's trigram indexes.

-- ── 1. The nav badge count ───────────────────────────────────────────────────────────────
-- PrescriptionRepository#countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNullAndViewedAtIsNull
-- backs usePrescriptionNewCount(), which polls every 20s from EVERY logged-in pharmacist on
-- EVERY dashboard page (it's wired into TopNav, not scoped to the Prescriptions screen) — the
-- single highest-frequency query anywhere in this module. None of the three existing indexes
-- on "prescriptions" (pharmacyId+status, pharmacyId+doctorId, pharmacyId+createdAt) cover this
-- predicate shape. Partial and count-only, so it stays tiny: only unviewed clinic-sourced rows
-- are ever counted, and nothing here needs to be returned in any particular order.
CREATE INDEX IF NOT EXISTS "prescriptions_unviewed_emr_idx"
  ON "prescriptions" ("pharmacyId")
  WHERE "externalEmrPrescriptionId" IS NOT NULL AND "viewedAt" IS NULL;

-- ── 2. The Integrations screen's own stats ───────────────────────────────────────────────
-- EmrConnectionService#toStatus polls (while a pairing code is outstanding) two queries this
-- also serves: countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNull (no viewedAt condition —
-- "how many ever arrived", not "how many are unread") and findLastEmrPrescriptionAt
-- (MAX(createdAt) with the same WHERE). Including createdAt makes the MAX query a pure
-- index-only backward scan instead of a filtered table scan.
CREATE INDEX IF NOT EXISTS "prescriptions_emr_sourced_idx"
  ON "prescriptions" ("pharmacyId", "createdAt")
  WHERE "externalEmrPrescriptionId" IS NOT NULL;

-- ── 3. Prescription search ───────────────────────────────────────────────────────────────
-- PrescriptionRepository#search matches LOWER(patientName|doctorName|prescriptionNumber)
-- LIKE LOWER('%term%') — a LEADING wildcard, which no B-tree (functional or otherwise) can
-- serve. This is the exact class of problem already fixed for the medicine catalogue in
-- 20260818000001 (see that migration for the full "why GIN + pg_trgm" reasoning); the fix is
-- the same here.
--
-- Unlike the medicine catalogue, prescriptions ARE tenant-scoped, and a patient or doctor
-- name is not unique to one pharmacy — "Ramesh Kumar" can exist at hundreds of pharmacies on
-- the platform. A pure trigram index (matching the medicines pattern exactly) would let
-- Postgres find every matching row PLATFORM-WIDE before filtering down to this pharmacyId.
-- btree_gin lets a plain equality column sit in the same multi-column GIN index as the
-- trigram-matched text, so pharmacyId narrows the search inside the index itself rather than
-- as a separate filter step afterward — the correct shape for a per-tenant searchable table.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE INDEX IF NOT EXISTS "prescriptions_pharmacyId_patientName_lower_trgm_idx"
  ON "prescriptions" USING GIN ("pharmacyId", LOWER("patientName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "prescriptions_pharmacyId_doctorName_lower_trgm_idx"
  ON "prescriptions" USING GIN ("pharmacyId", LOWER("doctorName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "prescriptions_pharmacyId_prescriptionNumber_lower_trgm_idx"
  ON "prescriptions" USING GIN ("pharmacyId", LOWER("prescriptionNumber") gin_trgm_ops);

-- Small tables today, so plain CREATE INDEX (not CONCURRENTLY) is fine at this size — see
-- 20260628000004 for the precedent. If any of these are large when actually applied, run the
-- CONCURRENTLY variant by hand instead (each one on its own, outside a transaction):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "prescriptions_unviewed_emr_idx" ...
