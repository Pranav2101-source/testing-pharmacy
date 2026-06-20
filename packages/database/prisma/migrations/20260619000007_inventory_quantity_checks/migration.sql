-- Enforce non-negative stock quantities at the database level.
--
-- The application's reservation mechanism and service-layer guards reduce the
-- risk of negative inventory, but without a DB constraint a race condition,
-- a bug, or a direct SQL write can produce rows where quantity < 0 — meaning
-- stock that doesn't exist was sold and revenue was booked against thin air.
--
-- Pre-flight: log (don't fix silently) any existing violations so ops can
-- investigate and correct them before applying the constraints.
DO $$
DECLARE
  neg_qty   INTEGER;
  neg_rsv   INTEGER;
BEGIN
  SELECT COUNT(*) INTO neg_qty FROM inventory WHERE quantity < 0;
  SELECT COUNT(*) INTO neg_rsv FROM inventory WHERE "reservedQuantity" < 0;
  IF neg_qty > 0 THEN
    RAISE WARNING 'inventory: % row(s) have quantity < 0 — correct before constraining', neg_qty;
  END IF;
  IF neg_rsv > 0 THEN
    RAISE WARNING 'inventory: % row(s) have reservedQuantity < 0 — correct before constraining', neg_rsv;
  END IF;
END $$;

-- Clamp any development-era negatives to 0 so the constraint applies cleanly.
UPDATE inventory SET quantity          = 0 WHERE quantity          < 0;
UPDATE inventory SET "reservedQuantity" = 0 WHERE "reservedQuantity" < 0;

ALTER TABLE inventory
  ADD CONSTRAINT inventory_quantity_non_negative
  CHECK (quantity >= 0);

ALTER TABLE inventory
  ADD CONSTRAINT inventory_reserved_quantity_non_negative
  CHECK ("reservedQuantity" >= 0);
