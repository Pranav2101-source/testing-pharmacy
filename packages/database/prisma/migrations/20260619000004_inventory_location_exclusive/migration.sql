-- inventory.location (free-text) and inventory.shelfId (FK to shelf) describe
-- the same physical placement.  Having both set simultaneously means they can
-- contradict each other — the stock audit page, inventory list, and GRN receipt
-- all pick one or the other arbitrarily.
--
-- Fix: add a CHECK constraint so the DB rejects any row where both are set.
-- The application code (upsertBatch, updateLocation) already clears one field
-- when the other is supplied.
--
-- Pre-flight: resolve any existing conflicts by letting shelfId win (structured
-- data is more reliable than free-text).  This UPDATE is idempotent.

UPDATE inventory
SET    location = NULL
WHERE  location IS NOT NULL
  AND  "shelfId" IS NOT NULL;

-- Now add the constraint.
ALTER TABLE inventory
  ADD CONSTRAINT inventory_location_or_shelf_exclusive
  CHECK (location IS NULL OR "shelfId" IS NULL);
