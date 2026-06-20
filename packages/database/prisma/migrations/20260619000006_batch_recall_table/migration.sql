-- BatchRecall: dedicated table replacing the string-probe pattern on
-- InventoryMovement (notes LIKE 'RECALL:%').
--
-- The old approach was fragile: a recall audit trail that depended on a
-- specific note prefix was unresolvable if the note changed format, was
-- edited, or was written by a bulk import. Regulatory recall records must
-- have first-class representation.
--
-- Existing InventoryMovement rows with referenceType='BATCH_RECALL' are left
-- intact — they remain valid ledger entries and are now linked to new
-- BatchRecall rows via referenceId when future recalls occur. Historical
-- records before this migration retain the old note-based link.

CREATE TABLE "batch_recalls" (
  "id"          TEXT         NOT NULL,
  "pharmacyId"  TEXT         NOT NULL,
  "batchNumber" TEXT         NOT NULL,
  "medicineId"  TEXT,
  "reason"      TEXT         NOT NULL,
  "recalledBy"  TEXT         NOT NULL,
  "recalledAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "affectedIds" TEXT[]       NOT NULL DEFAULT '{}',

  CONSTRAINT "batch_recalls_pkey"                    PRIMARY KEY ("id"),
  CONSTRAINT "batch_recalls_pharmacyId_fkey"         FOREIGN KEY ("pharmacyId")  REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "batch_recalls_medicineId_fkey"         FOREIGN KEY ("medicineId")  REFERENCES "medicines"("id")  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "batch_recalls_recalledBy_fkey"         FOREIGN KEY ("recalledBy")  REFERENCES "users"("id")      ON UPDATE CASCADE
);

CREATE INDEX "batch_recalls_pharmacyId_batchNumber_idx"  ON "batch_recalls"("pharmacyId", "batchNumber");
CREATE INDEX "batch_recalls_pharmacyId_recalledAt_idx"   ON "batch_recalls"("pharmacyId", "recalledAt" DESC);
CREATE INDEX "batch_recalls_pharmacyId_medicineId_idx"   ON "batch_recalls"("pharmacyId", "medicineId");
