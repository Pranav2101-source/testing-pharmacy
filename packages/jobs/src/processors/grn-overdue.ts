import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { notifyOwners } from "@pharmacy/mailer";

function buildHtml(
  overdueGrns: { grnNumber: string; supplierName: string; totalAmount: number; paymentDueDate: Date; daysOverdue: number }[],
  pharmacyName: string,
): string {
  const total = overdueGrns.reduce((s, g) => s + g.totalAmount, 0);

  const rows = overdueGrns.map((g) =>
    `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${g.grnNumber}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${g.supplierName}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${g.paymentDueDate.toISOString().split("T")[0]}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600">${g.daysOverdue}d overdue</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">₹${g.totalAmount.toFixed(2)}</td>
    </tr>`,
  ).join("");

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
    <h2 style="color:#dc2626">Overdue Supplier Payments — ${pharmacyName}</h2>
    <p style="color:#555">${overdueGrns.length} invoice(s) overdue. Total outstanding: <strong>₹${total.toFixed(2)}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:8px 10px;text-align:left">GRN</th>
        <th style="padding:8px 10px;text-align:left">Supplier</th>
        <th style="padding:8px 10px;text-align:left">Due Date</th>
        <th style="padding:8px 10px;text-align:left">Status</th>
        <th style="padding:8px 10px;text-align:right">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr style="margin-top:32px">
    <p style="color:#888;font-size:12px">Automated alert from Checkup Pharmacy.</p>
  </body></html>`;
}

async function processPharmacy(pharmacyId: string): Promise<void> {
  const pharmacy = await prisma.pharmacy.findUnique({
    where:  { id: pharmacyId },
    select: { id: true, name: true },
  });
  if (!pharmacy) return;

  const now    = new Date();
  const overdue = await prisma.goodsReceiptNote.findMany({
    where: {
      pharmacyId:     pharmacy.id,
      status:         "CONFIRMED",
      paymentDueDate: { lt: now },
    },
    include: { supplier: { select: { name: true } } },
    orderBy: { paymentDueDate: "asc" },
  });

  if (overdue.length === 0) return;

  const rows = overdue.map((g) => ({
    grnNumber:      g.grnNumber,
    supplierName:   g.supplier.name,
    totalAmount:    g.totalAmount,
    paymentDueDate: g.paymentDueDate!,
    daysOverdue:    Math.floor((now.getTime() - g.paymentDueDate!.getTime()) / 86_400_000),
  }));

  const total   = rows.reduce((s, r) => s + r.totalAmount, 0);
  const message =
    `${overdue.length} supplier payment(s) are overdue. Total outstanding: ₹${total.toFixed(2)}\n\n` +
    rows.map((r) => `${r.grnNumber} — ${r.supplierName} — ₹${r.totalAmount.toFixed(2)} — ${r.daysOverdue}d overdue`).join("\n");

  await notifyOwners(prisma, pharmacy.id, {
    subject: `⚠️ ${overdue.length} Supplier Payment(s) Overdue — ${pharmacy.name}`,
    message,
    html:    buildHtml(rows, pharmacy.name),
  });

  console.info(`[grn-overdue][${pharmacy.name}] sent alert: ${overdue.length} invoices`);
}

export async function grnOverdueHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  const results = await Promise.allSettled(pharmacies.map((p) => processPharmacy(p.id)));
  const failed  = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[grn-overdue] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[grn-overdue] error:", f.reason);
    }
  }
}
