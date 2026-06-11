import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection } from "../queue.client.js";
import { onWorkerFailed } from "../on-worker-failed.js";
import { notifyOwners, sendNotification } from "../../lib/notifications.js";

export type PostInvoiceJobData = {
  pharmacyId:    string;
  invoiceId:     string;
  invoiceNumber: string;
  totalAmount:   number;
  paymentMode:   string;
  customerId:    string | null;
};

export const postInvoiceWorker = new Worker(
  "post-invoice",
  async (job) => {
    const {
      pharmacyId,
      invoiceNumber,
      totalAmount,
      paymentMode,
      customerId,
    } = job.data as PostInvoiceJobData;

    const [pharmacy, customer] = await Promise.all([
      prisma.pharmacy.findUnique({
        where:  { id: pharmacyId },
        select: { name: true },
      }),
      customerId
        ? prisma.customer.findFirst({
            where:  { id: customerId, pharmacyId },
            select: { name: true, email: true, creditLimit: true, creditUsed: true },
          })
        : Promise.resolve(null),
    ]);

    // 1. Invoice receipt to customer
    if (customer?.email) {
      await sendNotification(prisma, {
        pharmacyId,
        recipient: customer.email,
        subject:   `Your bill from ${pharmacy?.name ?? "Pharmacy"} — ₹${totalAmount.toFixed(2)}`,
        message:   `Invoice ${invoiceNumber} for ₹${totalAmount.toFixed(2)}.\nPayment: ${paymentMode}.\nThank you for your purchase!`,
      });
      job.log(`Receipt sent to ${customer.email}`);
    }

    // 2. Credit-limit warning to owners when usage crosses 80%.
    // creditUsed is read AFTER the invoice transaction committed, so it already
    // reflects this invoice's contribution — no separate fetch needed.
    if (customer !== null && paymentMode === "CREDIT" && customer.creditLimit > 0) {
      const usedPct = (customer.creditUsed / customer.creditLimit) * 100;
      if (usedPct >= 80) {
        await notifyOwners(prisma, pharmacyId, {
          subject: `Credit limit warning — ${customer.name}`,
          message: `${customer.name} has used ₹${customer.creditUsed.toFixed(2)} of ₹${customer.creditLimit.toFixed(2)} (${usedPct.toFixed(0)}%). Invoice: ${invoiceNumber}.`,
        });
        job.log(`Credit warning sent for ${customer.name} (${usedPct.toFixed(0)}% used)`);
      }
    }
  },
  {
    connection,
    concurrency: 5,
    stalledInterval: 60_000,
  },
);
onWorkerFailed(postInvoiceWorker);
