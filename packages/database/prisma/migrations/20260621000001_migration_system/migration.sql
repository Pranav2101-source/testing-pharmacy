-- CreateEnum
CREATE TYPE "MigrationSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "MigrationEntityType" AS ENUM ('INVENTORY', 'SUPPLIERS', 'CUSTOMERS', 'DOCTORS', 'MEDICINE');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "migration_sessions" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "status" "MigrationSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "sourceSoftware" TEXT,
    "completedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentStep" TEXT,
    "columnMappings" JSONB,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_import_jobs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "entityType" "MigrationEntityType" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "pgBossJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_mappings" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "csvValue" TEXT NOT NULL,
    "medicineId" TEXT,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_created_records" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entityType" "MigrationEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_created_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "migration_sessions_pharmacyId_status_idx" ON "migration_sessions"("pharmacyId", "status");

-- CreateIndex
CREATE INDEX "migration_import_jobs_sessionId_idx" ON "migration_import_jobs"("sessionId");

-- CreateIndex
CREATE INDEX "migration_import_jobs_pharmacyId_entityType_idx" ON "migration_import_jobs"("pharmacyId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_mappings_pharmacyId_csvValue_key" ON "medicine_mappings"("pharmacyId", "csvValue");

-- CreateIndex
CREATE INDEX "medicine_mappings_pharmacyId_idx" ON "medicine_mappings"("pharmacyId");

-- CreateIndex
CREATE INDEX "migration_created_records_sessionId_entityType_idx" ON "migration_created_records"("sessionId", "entityType");

-- AddForeignKey
ALTER TABLE "migration_sessions" ADD CONSTRAINT "migration_sessions_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_sessions" ADD CONSTRAINT "migration_sessions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_import_jobs" ADD CONSTRAINT "migration_import_jobs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "migration_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_import_jobs" ADD CONSTRAINT "migration_import_jobs_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_mappings" ADD CONSTRAINT "medicine_mappings_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_mappings" ADD CONSTRAINT "medicine_mappings_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_created_records" ADD CONSTRAINT "migration_created_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "migration_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
