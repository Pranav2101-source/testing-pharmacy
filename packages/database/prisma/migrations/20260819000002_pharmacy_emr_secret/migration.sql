ALTER TABLE "pharmacies"
    ADD COLUMN "emrSecretCiphertext" TEXT,
    ADD COLUMN "emrSecretIv" TEXT,
    ADD COLUMN "emrSecretTag" TEXT;
