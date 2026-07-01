-- Add shelf/location label to invoice line items for audit trail and receipt display
ALTER TABLE "invoice_items" ADD COLUMN "location" TEXT;
