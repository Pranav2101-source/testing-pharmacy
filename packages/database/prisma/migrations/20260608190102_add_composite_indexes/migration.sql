-- CreateIndex
CREATE INDEX "inventory_pharmacyId_status_quantity_idx" ON "inventory"("pharmacyId", "status", "quantity");

-- CreateIndex
CREATE INDEX "inventory_pharmacyId_medicineId_status_expiryDate_idx" ON "inventory"("pharmacyId", "medicineId", "status", "expiryDate");

-- CreateIndex
CREATE INDEX "inventory_movements_pharmacyId_type_createdAt_idx" ON "inventory_movements"("pharmacyId", "type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "invoices_pharmacyId_paymentStatus_isCancelled_idx" ON "invoices"("pharmacyId", "paymentStatus", "isCancelled");

-- CreateIndex
CREATE INDEX "invoices_pharmacyId_isCancelled_createdAt_idx" ON "invoices"("pharmacyId", "isCancelled", "createdAt" DESC);
