-- The clinic each pharmacy is connected to, entered by the pharmacy itself.
-- Nullable: an unconnected pharmacy is the normal starting state, and the
-- callback path already treats a missing address as "not configured".
ALTER TABLE "pharmacies"
    ADD COLUMN "emrClinicName" TEXT,
    ADD COLUMN "emrCallbackUrl" TEXT,
    ADD COLUMN "emrConnectedAt" TIMESTAMP(3);
