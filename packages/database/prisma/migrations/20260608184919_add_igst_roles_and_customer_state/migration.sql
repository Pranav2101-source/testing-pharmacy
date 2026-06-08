-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'MANAGER';
ALTER TYPE "Role" ADD VALUE 'CASHIER';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "isInterstate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN     "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;
