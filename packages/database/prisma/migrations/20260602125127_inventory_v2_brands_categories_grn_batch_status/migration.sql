-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'QUARANTINE', 'EXPIRED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "GRNStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PurchaseStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "medicines" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "pharmacies" RENAME CONSTRAINT "tenants_pkey" TO "pharmacies_pkey";

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "paymentTerms" TEXT;

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_notes" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "grnNumber" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT,
    "supplierInvoiceDate" TIMESTAMP(3),
    "status" "GRNStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalGst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_items" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "orderedQty" INTEGER,
    "receivedQty" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "purchaseRate" DOUBLE PRECISION NOT NULL,
    "mrp" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate" DOUBLE PRECISION NOT NULL,
    "cgst" DOUBLE PRECISION NOT NULL,
    "sgst" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "inventoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grn_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE INDEX "brands_name_idx" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");

-- CreateIndex
CREATE INDEX "product_categories_name_idx" ON "product_categories"("name");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_pharmacyId_status_idx" ON "goods_receipt_notes"("pharmacyId", "status");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_pharmacyId_supplierId_idx" ON "goods_receipt_notes"("pharmacyId", "supplierId");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_pharmacyId_createdAt_idx" ON "goods_receipt_notes"("pharmacyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_notes_pharmacyId_grnNumber_key" ON "goods_receipt_notes"("pharmacyId", "grnNumber");

-- CreateIndex
CREATE INDEX "grn_items_grnId_idx" ON "grn_items"("grnId");

-- CreateIndex
CREATE INDEX "inventory_pharmacyId_status_idx" ON "inventory"("pharmacyId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_pharmacyId_supplierId_idx" ON "purchase_orders"("pharmacyId", "supplierId");

-- RenameForeignKey
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_tenantId_fkey" TO "audit_logs_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "customers" RENAME CONSTRAINT "customers_tenantId_fkey" TO "customers_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "inventory" RENAME CONSTRAINT "inventory_tenantId_fkey" TO "inventory_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "inventory_movements" RENAME CONSTRAINT "inventory_movements_tenantId_fkey" TO "inventory_movements_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "invoice_payments" RENAME CONSTRAINT "invoice_payments_tenantId_fkey" TO "invoice_payments_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "invoice_settings" RENAME CONSTRAINT "invoice_settings_tenantId_fkey" TO "invoice_settings_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_tenantId_fkey" TO "invoices_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "notification_logs" RENAME CONSTRAINT "notification_logs_tenantId_fkey" TO "notification_logs_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "purchase_orders" RENAME CONSTRAINT "purchase_orders_tenantId_fkey" TO "purchase_orders_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "sales_returns" RENAME CONSTRAINT "sales_returns_tenantId_fkey" TO "sales_returns_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "stock_reservations" RENAME CONSTRAINT "stock_reservations_tenantId_fkey" TO "stock_reservations_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "suppliers" RENAME CONSTRAINT "suppliers_tenantId_fkey" TO "suppliers_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "uploads" RENAME CONSTRAINT "uploads_tenantId_fkey" TO "uploads_pharmacyId_fkey";

-- RenameForeignKey
ALTER TABLE "users" RENAME CONSTRAINT "users_tenantId_fkey" TO "users_pharmacyId_fkey";

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "tenants_slug_key" RENAME TO "pharmacies_slug_key";
