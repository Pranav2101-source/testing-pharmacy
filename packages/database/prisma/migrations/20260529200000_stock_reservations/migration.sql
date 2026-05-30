-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_tenantId_inventoryId_sessionId_key" ON "stock_reservations"("tenantId", "inventoryId", "sessionId");

-- CreateIndex
CREATE INDEX "stock_reservations_tenantId_sessionId_idx" ON "stock_reservations"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "stock_reservations_expiresAt_idx" ON "stock_reservations"("expiresAt");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
