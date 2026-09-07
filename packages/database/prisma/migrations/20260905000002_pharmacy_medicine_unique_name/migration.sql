-- Defense-in-depth for the pharmacy_medicines find-or-create race (see
-- AdvisoryLock / PurchasesService.resolveMedicineRefs / PharmacyMedicineService.create).
--
-- The app now takes a transaction-scoped Postgres advisory lock, keyed on
-- (pharmacyId, lower(name)), before resolving a GRN's unmatched line or a
-- "Save as Local Medicine" request to an existing-or-new PharmacyMedicine
-- row. That closes the race for every current write path. This unique index
-- is the backstop underneath it: if the app-level lock is ever bypassed (a
-- bug, a future direct-write path, a raw SQL fix), the database itself
-- refuses a second identity for the same pharmacy+name rather than silently
-- fragmenting one product's stock/history across two rows.
--
-- No data risk: pre-existing rows were already deduplicated by the
-- application (findFirstByPharmacyIdAndNameIgnoreCase reuses on exact,
-- case-insensitive name match), so this is expected to already hold.
CREATE UNIQUE INDEX "pharmacy_medicines_pharmacyId_lower_name_key"
  ON "pharmacy_medicines" ("pharmacyId", LOWER("name"));
