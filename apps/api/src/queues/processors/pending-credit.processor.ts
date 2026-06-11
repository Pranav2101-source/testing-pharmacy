import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection, pendingCreditQueue } from "../queue.client.js";
import { onWorkerFailed } from "../on-worker-failed.js";
import { notifyOwners } from "../../lib/notifications.js";

function buildHtml(
  invoices: { invoiceNumber: string; customerName: string; totalAmount: number; createdAt: Date; ageDays: number }[],
  total: number,
  pharmacyName: string,
): string {
  const rows = invoices.map((inv) =>
    `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${inv.invoiceNumber}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${inv.customerName}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${inv.createdAt.toISOString().split("T")[0]}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#d97706">${inv.ageDays}d old</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">₹${inv.totalAmount.toFixed(2)}</td>
    </tr>`,
  ).join("");

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
    <h2 style="color:#d97706">Pending Credit Invoices — ${pharmacyName}</h2>
    <p style="color:#555">${invoices.length} invoice(s) unpaid. Total outstanding: <strong>₹${total.toFixed(2)}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:8px 10px;text-align:left">Invoice</th>
        <th style="padding:8px 10px;text-align:left">Customer</th>
        <th style="padding:8px 10px;text-align:left">Date</th>
        <th style="padding:8px 10px;text-align:left">Age</th>
        <th style="padding:8px 10px;text-align:right">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr style="margin-top:32px">
    <p style="color:#888;font-size:12px">Weekly digest from Checkup Pharmacy.</p>
  </body></html>`;
}

export const pendingCreditWorker = new Worker(
  "pending-credit-digest",
  async (job) => {
    const { pharmacyId } = job.data as { pharmacyId?: string };

    if (!pharmacyId) {
      const pharmacies = await prisma.pharmacy.findMany({
        where:  { isActive: true },
        select: { id: true },
      });
      const results = await Promise.allSettled(
        pharmacies.map((p) =>
          pendingCreditQueue.add(`pharmacy:${p.id}`, { pharmacyId: p.id }, {
            removeOnComplete: { count: 1 },
            removeOnFail:     { count: 3 },
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) job.log(`Warning: ${failed} pharmacy job(s) failed to enqueue`);
      job.log(`Dispatched ${pharmacies.length - failed}/${pharmacies.length} pending-credit job(s)`);
      return;
    }

    const pharmacy = await prisma.pharmacy.findUnique({
      where:  { id: pharmacyId },
      select: { id: true, name: true },
    });
    if (!pharmacy) return;

    const now     = new Date();
    const pending = await prisma.invoice.findMany({
      where: {
        pharmacyId:    pharmacy.id,
        paymentStatus: "PENDING",
        isCancelled:   false,
      },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take:    50,
    });

    if (pending.length === 0) return;

    const rows = pending.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      customerName:  inv.customer?.name ?? "Walk-in",
      totalAmount:   inv.totalAmount,
      createdAt:     inv.createdAt,
      ageDays:       Math.floor((now.getTime() - inv.createdAt.getTime()) / 86_400_000),
    }));

    const total   = rows.reduce((s, r) => s + r.totalAmount, 0);
    const message =
      `Weekly Pending Credit Digest — ${pharmacy.name}\n\n` +
      `${pending.length} invoice(s) unpaid. Total: ₹${total.toFixed(2)}\n\n` +
      rows.map((r) => `${r.invoiceNumber} — ${r.customerName} — ₹${r.totalAmount.toFixed(2)} — ${r.ageDays}d old`).join("\n");

    await notifyOwners(prisma, pharmacy.id, {
      subject: `Weekly Digest: ₹${total.toFixed(2)} in Pending Credit — ${pharmacy.name}`,
      message,
      html:    buildHtml(rows, total, pharmacy.name),
    });

    job.log(`[${pharmacy.name}] pending-credit digest: ${pending.length} invoices ₹${total.toFixed(2)}`);
  },
  { connection, concurrency: 5, drainDelay: 300, stalledInterval: 300_000 },
);
onWorkerFailed(pendingCreditWorker);
