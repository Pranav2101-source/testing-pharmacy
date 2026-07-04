import { boss } from "./boss.js";

export type MigrationEntityType = "INVENTORY" | "SUPPLIERS" | "CUSTOMERS" | "DOCTORS";

export type MigrationImportJobData = {
  jobId:          string;
  sessionId:      string;
  pharmacyId:     string;
  userId:         string;
  entityType:     MigrationEntityType;
  csvText:        string;
  columnMappings: Record<string, string>;
};

export async function enqueueMigrationImport(data: MigrationImportJobData): Promise<string | null> {
  return boss.send("migration-import", data, {
    retryLimit:      2,
    retryDelay:      10,
    retryBackoff:    true,
    expireInSeconds: 3_600,  // 1 hour max for a large import
  });
}

export type PostInvoiceJobData = {
  pharmacyId:    string;
  invoiceId:     string;
  invoiceNumber: string;
  totalAmount:   number;
  paymentMode:   string;
  customerId:    string | null;
};

// Fire-and-forget: enqueue a post-invoice job.
// Retries 3× with exponential backoff (5 s, 10 s, 20 s).
// Expires after 1 hour — if unclaimed, discard rather than accumulate.
export async function enqueuePostInvoice(data: PostInvoiceJobData): Promise<void> {
  await boss.send("post-invoice", data, {
    retryLimit:  3,
    retryDelay:  5,
    retryBackoff: true,
    expireInSeconds: 3_600,
  });
}
