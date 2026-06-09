-- Customer Module v2
-- Adds: ABHA number, card number, date of birth, default discount,
--       notes, soft-delete (deletedAt), createdById audit field.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "abhaNumber"      TEXT;
ALTER TABLE "customers" ADD COLUMN "cardNumber"      TEXT;
ALTER TABLE "customers" ADD COLUMN "createdById"     TEXT;
ALTER TABLE "customers" ADD COLUMN "dateOfBirth"     TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "defaultDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN "deletedAt"       TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "notes"           TEXT;

-- Unique card number per pharmacy (NULLs are distinct in PostgreSQL unique indexes)
CREATE UNIQUE INDEX "customers_pharmacyId_cardNumber_key" ON "customers"("pharmacyId", "cardNumber");

-- Fast lookup indexes for billing search
CREATE INDEX "customers_pharmacyId_name_idx"      ON "customers"("pharmacyId", "name");
CREATE INDEX "customers_pharmacyId_abhaNumber_idx" ON "customers"("pharmacyId", "abhaNumber");
CREATE INDEX "customers_pharmacyId_deletedAt_idx"  ON "customers"("pharmacyId", "deletedAt");
