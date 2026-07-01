-- AI features: getMedicineDailySales joins inventory_movements on inventoryId
-- then filters direction+type+createdAt. Without a composite index Postgres
-- scans the full movement history for every batch item — O(N×M) at scale.
-- With this index it can seek directly to SALE/OUT rows within the time window.
CREATE INDEX IF NOT EXISTS "inventory_movements_inventoryId_direction_type_createdAt_idx"
  ON "inventory_movements" ("inventoryId", direction, type, "createdAt" DESC);

-- calibrateMinimumStock uses DISTINCT ON (medicineId) ORDER BY medicineId, createdAt DESC.
-- This index lets Postgres resolve the DISTINCT ON via an index scan instead of a sort.
CREATE INDEX IF NOT EXISTS "inventory_pharmacyId_status_medicineId_createdAt_idx"
  ON "inventory" ("pharmacyId", status, "medicineId", "createdAt" DESC);
