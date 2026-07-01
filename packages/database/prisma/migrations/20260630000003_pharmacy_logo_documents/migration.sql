-- Pharmacy logo (Supabase storage path, signed on read) and compliance documents JSON
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "documents" JSONB;

-- New upload type for pharmacy compliance document scans
ALTER TYPE "UploadType" ADD VALUE IF NOT EXISTS 'PHARMACY_DOCUMENT';
