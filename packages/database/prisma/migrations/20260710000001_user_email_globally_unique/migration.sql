-- Email is the login identifier and must be unique across the whole system,
-- not just within one pharmacy. The old composite constraint let two
-- different pharmacies create a user with the same email, and login (which
-- looks a user up by email alone) had no way to tell them apart.
--
-- NOTE: if any duplicate emails already exist across different pharmacies in
-- this database, this migration will fail with a unique-violation error and
-- will not apply (Postgres DDL is transactional, so this is a safe no-op
-- failure, not a partial/corrupt state). Before running this in an
-- environment with real data, check for collisions first:
--
--   SELECT email, COUNT(DISTINCT "pharmacyId") AS pharmacies
--   FROM users
--   GROUP BY email
--   HAVING COUNT(DISTINCT "pharmacyId") > 1;
--
-- If that returns any rows, resolve them (e.g. change one account's email)
-- before applying this migration.

-- DropIndex
DROP INDEX "users_pharmacyId_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
