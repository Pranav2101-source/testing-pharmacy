-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_tenantId_idempotencyKey_key" ON "sales_returns"("tenantId", "idempotencyKey");
