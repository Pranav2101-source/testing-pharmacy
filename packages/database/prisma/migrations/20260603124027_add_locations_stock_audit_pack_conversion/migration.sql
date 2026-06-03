-- CreateEnum
CREATE TYPE "AuditSessionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "grn_items" ADD COLUMN     "conversionFactor" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "purchaseUnit" TEXT NOT NULL DEFAULT 'UNIT';

-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "shelfId" TEXT;

-- AlterTable
ALTER TABLE "medicines" ADD COLUMN     "boxSize" INTEGER;

-- CreateTable
CREATE TABLE "racks" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aisle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "racks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelves" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_audit_sessions" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "sessionNumber" TEXT NOT NULL,
    "status" "AuditSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_audit_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_audit_items" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "varianceQty" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_audit_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "racks_pharmacyId_idx" ON "racks"("pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "racks_pharmacyId_code_key" ON "racks"("pharmacyId", "code");

-- CreateIndex
CREATE INDEX "shelves_pharmacyId_rackId_idx" ON "shelves"("pharmacyId", "rackId");

-- CreateIndex
CREATE UNIQUE INDEX "shelves_pharmacyId_code_key" ON "shelves"("pharmacyId", "code");

-- CreateIndex
CREATE INDEX "stock_audit_sessions_pharmacyId_status_idx" ON "stock_audit_sessions"("pharmacyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_audit_sessions_pharmacyId_sessionNumber_key" ON "stock_audit_sessions"("pharmacyId", "sessionNumber");

-- CreateIndex
CREATE INDEX "stock_audit_items_sessionId_idx" ON "stock_audit_items"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_audit_items_sessionId_inventoryId_key" ON "stock_audit_items"("sessionId", "inventoryId");

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "racks" ADD CONSTRAINT "racks_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "racks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_audit_sessions" ADD CONSTRAINT "stock_audit_sessions_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_audit_items" ADD CONSTRAINT "stock_audit_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stock_audit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_audit_items" ADD CONSTRAINT "stock_audit_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
