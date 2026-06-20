import { boss } from "./boss.js";

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
