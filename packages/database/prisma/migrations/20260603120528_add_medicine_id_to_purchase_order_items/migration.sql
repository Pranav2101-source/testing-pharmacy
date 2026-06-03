-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "medicineId" TEXT;

-- CreateIndex
CREATE INDEX "purchase_order_items_medicineId_idx" ON "purchase_order_items"("medicineId");

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
