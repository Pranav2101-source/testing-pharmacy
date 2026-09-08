-- AlterEnum
BEGIN;
CREATE TYPE "AuditModule_new" AS ENUM ('AUTH', 'TENANTS', 'SUBSCRIPTIONS', 'SUPPORT', 'SETTINGS', 'SYSTEM', 'ANALYTICS', 'AUDIT', 'BILLING', 'INVENTORY');
ALTER TABLE "audit_logs" ALTER COLUMN "module" DROP DEFAULT;
ALTER TABLE "audit_logs" ALTER COLUMN "module" TYPE "AuditModule_new" USING ("module"::text::"AuditModule_new");
ALTER TYPE "AuditModule" RENAME TO "AuditModule_old";
ALTER TYPE "AuditModule_new" RENAME TO "AuditModule";
DROP TYPE "AuditModule_old";
ALTER TABLE "audit_logs" ALTER COLUMN "module" SET DEFAULT 'SYSTEM';
COMMIT;

-- DropForeignKey
ALTER TABLE "api_credentials" DROP CONSTRAINT "api_credentials_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "api_credentials" DROP CONSTRAINT "api_credentials_userId_fkey";

-- DropForeignKey
ALTER TABLE "clinic_links" DROP CONSTRAINT "clinic_links_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "grn_items" DROP CONSTRAINT "grn_items_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "inventory" DROP CONSTRAINT "inventory_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "invoice_settings" DROP CONSTRAINT "invoice_settings_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "prescription_items" DROP CONSTRAINT "prescription_items_substitutedFromMedicineId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_purchaseOrderId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_credit_notes" DROP CONSTRAINT "supplier_credit_notes_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "supplier_credit_notes" DROP CONSTRAINT "supplier_credit_notes_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_credit_notes" DROP CONSTRAINT "supplier_credit_notes_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_credit_notes" DROP CONSTRAINT "supplier_credit_notes_supplierReturnId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_ledger_entries" DROP CONSTRAINT "supplier_ledger_entries_grnId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_ledger_entries" DROP CONSTRAINT "supplier_ledger_entries_supplierReturnId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_grnId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_return_items" DROP CONSTRAINT "supplier_return_items_inventoryId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_return_items" DROP CONSTRAINT "supplier_return_items_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_return_items" DROP CONSTRAINT "supplier_return_items_pharmacyId_fkey";

-- DropForeignKey
ALTER TABLE "supplier_return_items" DROP CONSTRAINT "supplier_return_items_returnId_fkey";

-- DropIndex
DROP INDEX "goods_receipt_notes_pharmacyId_status_createdAt_idx";

-- DropIndex
DROP INDEX "prescriptions_pharmacyId_sourceSystem_createdAt_idx";

-- AlterTable
ALTER TABLE "prescription_items" DROP COLUMN "computedQuantity",
DROP COLUMN "emrItemId",
DROP COLUMN "quantityConfirmed",
DROP COLUMN "substitutedFromMedicineId";

-- AlterTable
ALTER TABLE "prescriptions" DROP COLUMN "emrClinicId",
DROP COLUMN "emrDoctorId",
DROP COLUMN "emrPatientId",
DROP COLUMN "emrPrescriptionId",
DROP COLUMN "sourceSystem",
ALTER COLUMN "dispenseNotifiedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "dispenseNotifyNextAttemptAt" SET DATA TYPE TIMESTAMP(3);

-- DropTable
DROP TABLE "api_credentials";

-- DropTable
DROP TABLE "clinic_links";

-- DropTable
DROP TABLE "invoice_settings";

-- DropTable
DROP TABLE "pairing_codes";

-- DropTable
DROP TABLE "purchase_order_items";

-- DropTable
DROP TABLE "supplier_credit_notes";

-- DropTable
DROP TABLE "supplier_payments";

-- DropTable
DROP TABLE "supplier_return_items";

-- CreateIndex
CREATE INDEX "goods_receipt_notes_pharmacyId_status_createdAt_idx" ON "goods_receipt_notes"("pharmacyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_pharmacyId_status_medicineId_createdAt_idx" ON "inventory"("pharmacyId", "status", "medicineId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_movements_inventoryId_direction_type_createdAt_idx" ON "inventory_movements"("inventoryId", "direction", "type", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pharmacies_emrApiKey_key" ON "pharmacies"("emrApiKey");

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_items" ADD CONSTRAINT "grn_items_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ledger_entries" ADD CONSTRAINT "supplier_ledger_entries_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "supplier_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "prescriptions_pharmacyId_externalEmrTenantId_externalEmrPrescri" RENAME TO "prescriptions_pharmacyId_externalEmrTenantId_externalEmrPre_key";

