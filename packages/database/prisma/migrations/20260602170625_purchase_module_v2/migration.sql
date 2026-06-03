-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'EXPIRED', 'CONVERTED');

-- AlterTable
ALTER TABLE "goods_receipt_notes" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "paymentDueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "expectedDate" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "grnId" TEXT,
    "paymentNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_notes" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierReturnId" TEXT,
    "creditNoteNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quotedRate" DOUBLE PRECISION,
    "mrp" DOUBLE PRECISION,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_payments_pharmacyId_supplierId_idx" ON "supplier_payments"("pharmacyId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_payments_pharmacyId_paidAt_idx" ON "supplier_payments"("pharmacyId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_pharmacyId_paymentNumber_key" ON "supplier_payments"("pharmacyId", "paymentNumber");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_pharmacyId_supplierId_idx" ON "supplier_credit_notes"("pharmacyId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_credit_notes_pharmacyId_status_idx" ON "supplier_credit_notes"("pharmacyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_credit_notes_pharmacyId_creditNoteNumber_key" ON "supplier_credit_notes"("pharmacyId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX "quotations_pharmacyId_supplierId_idx" ON "quotations"("pharmacyId", "supplierId");

-- CreateIndex
CREATE INDEX "quotations_pharmacyId_status_idx" ON "quotations"("pharmacyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_pharmacyId_quotationNumber_key" ON "quotations"("pharmacyId", "quotationNumber");

-- CreateIndex
CREATE INDEX "quotation_items_quotationId_idx" ON "quotation_items"("quotationId");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_pharmacyId_paymentDueDate_idx" ON "goods_receipt_notes"("pharmacyId", "paymentDueDate");

-- CreateIndex
CREATE INDEX "purchase_orders_pharmacyId_approvalStatus_idx" ON "purchase_orders"("pharmacyId", "approvalStatus");

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "supplier_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_notes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
