-- CashClosure.closureDate: promote from TEXT "YYYY-MM-DD" to DATE.
--
-- The column was stored as a plain string (TEXT) with an implicit format convention
-- ("YYYY-MM-DD in IST") documented only in a schema comment. Consequences:
--   • No DB-level enforcement of the format — any string could be inserted.
--   • Date-range queries relied on lexicographic comparison (works for ISO dates,
--     but breaks if any row has a non-conforming value).
--   • Calendar arithmetic (add/subtract days, extract month) required application
--     code to parse the string rather than using Postgres native DATE functions.
--
-- Migration is safe: all existing values match /^\d{4}-\d{2}-\d{2}$/ by the
-- Zod validator on every write path, so the implicit USING cast will succeed
-- without data loss. Prisma's @db.Date maps to PostgreSQL DATE, which stores
-- the date without a time component — exactly what closureDate semantically is.
--
-- After this migration the unique constraint and all indexes are intact and still
-- work correctly; Postgres re-builds them automatically on ALTER COLUMN.

ALTER TABLE "cash_closures"
  ALTER COLUMN "closureDate" TYPE DATE USING "closureDate"::date;
