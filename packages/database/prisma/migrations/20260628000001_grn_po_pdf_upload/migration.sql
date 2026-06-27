-- AlterEnum
ALTER TYPE "UploadType" ADD VALUE 'GRN_PDF';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "sourceUploadId" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_notes" ADD COLUMN     "sourceUploadId" TEXT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sourceUploadId_fkey" FOREIGN KEY ("sourceUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_sourceUploadId_fkey" FOREIGN KEY ("sourceUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
