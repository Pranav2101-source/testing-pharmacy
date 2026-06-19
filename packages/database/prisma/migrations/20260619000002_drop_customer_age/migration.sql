-- Customer.age was a stale mutable integer stored at registration time.
-- It becomes incorrect after the customer's next birthday and conflicts with
-- the authoritative dateOfBirth column.  Drop it; age is now computed at
-- query time from dateOfBirth wherever it is needed.

ALTER TABLE "customers" DROP COLUMN IF EXISTS "age";
