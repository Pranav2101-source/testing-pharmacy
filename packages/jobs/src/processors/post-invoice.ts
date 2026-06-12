import type PgBoss from "pg-boss";
import { prisma } from "@pharmacy/database";
import { notifyOwners, sendNotification } from "@pharmacy/mailer";
import type { PostInvoiceJobData } from "../client.js";

export async function postInvoiceHandler(job: PgBoss.Job<PostInvoiceJobData>): Promise<void> {
  const { pharmacyId, invoiceNumber, totalAmount, paymentMode, customerId } = job.data;

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

  if (customer?.email) {
    await sendNotification(prisma, {
      pharmacyId,
      recipient: customer.email,
      subject:   `Your bill from ${pharmacy?.name ?? "Pharmacy"} — ₹${totalAmount.toFixed(2)}`,
      message:   `Invoice ${invoiceNumber} for ₹${totalAmount.toFixed(2)}.\nPayment: ${paymentMode}.\nThank you for your purchase!`,
    });
  }

  if (customer !== null && paymentMode === "CREDIT" && customer.creditLimit > 0) {
    const usedPct = (customer.creditUsed / customer.creditLimit) * 100;
    if (usedPct >= 80) {
      await notifyOwners(prisma, pharmacyId, {
        subject: `Credit limit warning — ${customer.name}`,
        message: `${customer.name} has used ₹${customer.creditUsed.toFixed(2)} of ₹${customer.creditLimit.toFixed(2)} (${usedPct.toFixed(0)}%). Invoice: ${invoiceNumber}.`,
      });
    }
  }
}
