-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'WRITEOFF');

-- CreateEnum
CREATE TYPE "SupplierReturnStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierReturnReason" AS ENUM ('DAMAGED', 'NEAR_EXPIRY', 'EXPIRED', 'WRONG_PRODUCT', 'QUALITY_ISSUE', 'SHORT_SUPPLY', 'OTHER');

-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "reorderLevel" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "medicines" ADD COLUMN     "barcode" TEXT;

-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN     "disposition" "ReturnDisposition" NOT NULL DEFAULT 'RESTOCK';

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "debitNoteNo" TEXT,
    "status" "SupplierReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchaseRate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" "SupplierReturnReason" NOT NULL DEFAULT 'DAMAGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_returns_pharmacyId_status_idx" ON "supplier_returns"("pharmacyId", "status");

-- CreateIndex
CREATE INDEX "supplier_returns_pharmacyId_supplierId_idx" ON "supplier_returns"("pharmacyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_pharmacyId_returnNumber_key" ON "supplier_returns"("pharmacyId", "returnNumber");

-- CreateIndex
CREATE INDEX "supplier_return_items_returnId_idx" ON "supplier_return_items"("returnId");

-- CreateIndex
CREATE INDEX "medicines_barcode_idx" ON "medicines"("barcode");

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
