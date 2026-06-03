-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "notification_logs_pharmacyId_isRead_idx" ON "notification_logs"("pharmacyId", "isRead");
