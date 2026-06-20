-- Invoice.isCancelled is a boolean denormalization of Invoice.status = 'CANCELLED'.
-- Both exist because the index (pharmacyId, isCancelled, createdAt) is cheaper
-- than filtering on the enum status column in the common "active invoices" list
-- query. The risk is that they diverge — a cancel that sets status but not
-- isCancelled (or vice versa) produces incorrect query results silently.
--
-- This CHECK constraint makes divergence physically impossible:
--   isCancelled = true  <=> status = 'CANCELLED'
--   isCancelled = false <=> status != 'CANCELLED'
--
-- Pre-flight: detect and fix any existing divergence before applying.

-- Case A: isCancelled=true but status != CANCELLED
UPDATE "invoices"
SET    "status" = 'CANCELLED'
WHERE  "isCancelled" = true
  AND  "status" != 'CANCELLED';

-- Case B: status=CANCELLED but isCancelled=false
UPDATE "invoices"
SET    "isCancelled" = true,
       "cancelledAt" = COALESCE("cancelledAt", "updatedAt", NOW())
WHERE  "status" = 'CANCELLED'
  AND  "isCancelled" = false;

-- Now both sides are consistent — add the constraint.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_cancelled_status_consistent"
  CHECK (
    ("isCancelled" = true  AND "status" = 'CANCELLED') OR
    ("isCancelled" = false AND "status" != 'CANCELLED')
  );
