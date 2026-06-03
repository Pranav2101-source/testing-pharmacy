-- Partial unique index: prevent duplicate supplier invoice numbers per supplier,
-- but only for non-cancelled GRNs and only when supplierInvoiceNo is not NULL.
-- Two GRNs with no invoice number (NULL) from the same supplier are always allowed.
CREATE UNIQUE INDEX "grn_supplier_invoice_no_unique"
  ON "goods_receipt_notes" ("pharmacyId", "supplierId", "supplierInvoiceNo")
  WHERE "supplierInvoiceNo" IS NOT NULL
    AND "status" != 'CANCELLED';
