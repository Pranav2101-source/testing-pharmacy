-- CreateTable
CREATE TABLE "pharmacy_medicine_overrides" (
    "pharmacyId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "gstRate" DECIMAL(12,2),
    "defaultDiscountPct" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_medicine_overrides_pkey" PRIMARY KEY ("pharmacyId","medicineId")
);

-- AddForeignKey
ALTER TABLE "pharmacy_medicine_overrides" ADD CONSTRAINT "pharmacy_medicine_overrides_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_medicine_overrides" ADD CONSTRAINT "pharmacy_medicine_overrides_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
