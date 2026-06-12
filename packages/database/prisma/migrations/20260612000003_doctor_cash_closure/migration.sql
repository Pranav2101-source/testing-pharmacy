-- CreateEnum
CREATE TYPE "ClosureStatus" AS ENUM ('DRAFT', 'CLOSED', 'DISPUTED');

-- AlterTable: add doctorId FK to invoices
ALTER TABLE "invoices" ADD COLUMN "doctorId" TEXT;

-- CreateTable: doctors
CREATE TABLE "doctors" (
    "id"             TEXT NOT NULL,
    "pharmacyId"     TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "registrationNo" TEXT,
    "specialty"      TEXT,
    "phone"          TEXT,
    "email"          TEXT,
    "address"        TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cash_closures
CREATE TABLE "cash_closures" (
    "id"           TEXT NOT NULL,
    "pharmacyId"   TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "closureDate"  TEXT NOT NULL,
    "openingCash"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashSales"    DECIMAL(12,2) NOT NULL DEFAULT 0,
    "upiSales"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cardSales"    DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditSales"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "walletSales"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualCash"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "variance"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes"        TEXT,
    "status"       "ClosureStatus" NOT NULL DEFAULT 'DRAFT',
    "closedAt"     TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctors_pharmacyId_name_idx" ON "doctors"("pharmacyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closures_pharmacyId_closureDate_key" ON "cash_closures"("pharmacyId", "closureDate");

-- CreateIndex
CREATE INDEX "cash_closures_pharmacyId_closureDate_idx" ON "cash_closures"("pharmacyId", "closureDate");

-- CreateIndex
CREATE INDEX "invoices_doctorId_idx" ON "invoices"("doctorId");

-- AddForeignKey: invoices.doctorId → doctors.id
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: doctors.pharmacyId → pharmacies.id
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: cash_closures.pharmacyId → pharmacies.id
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: cash_closures.userId → users.id
ALTER TABLE "cash_closures" ADD CONSTRAINT "cash_closures_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
