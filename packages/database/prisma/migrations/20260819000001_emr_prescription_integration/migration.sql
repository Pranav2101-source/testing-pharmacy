ALTER TABLE "prescriptions"
    ADD COLUMN "externalEmrTenantId" TEXT,
    ADD COLUMN "externalEmrPrescriptionId" TEXT,
    ADD COLUMN "externalEmrPrescriptionNumber" TEXT,
    ADD COLUMN "receivedAt" TIMESTAMP(3);

ALTER TABLE "prescription_items"
    ADD COLUMN "externalEmrItemId" TEXT;

CREATE UNIQUE INDEX "prescriptions_pharmacyId_externalEmrTenantId_externalEmrPrescriptionId_key"
    ON "prescriptions"("pharmacyId", "externalEmrTenantId", "externalEmrPrescriptionId");

CREATE UNIQUE INDEX "prescription_items_prescriptionId_externalEmrItemId_key"
    ON "prescription_items"("prescriptionId", "externalEmrItemId");
