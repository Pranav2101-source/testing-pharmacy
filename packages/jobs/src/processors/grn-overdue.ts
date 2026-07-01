import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

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
    supplierName: g.supplier.name,
    totalAmount:  g.totalAmount,
    daysOverdue:  Math.floor((now.getTime() - g.paymentDueDate!.getTime()) / 86_400_000),
  }));

  const total   = rows.reduce((s, r) => s + r.totalAmount, 0);
  const preview = rows.slice(0, 3).map((r) => `• ${r.supplierName} — ₹${r.totalAmount.toFixed(2)} (${r.daysOverdue}d overdue)`).join("\n");
  const more    = rows.length > 3 ? `\n…and ${rows.length - 3} more` : "";

  await inAppNotify(prisma, pharmacy.id, {
    subject: `⚠️ ${overdue.length} supplier payment(s) overdue — ₹${total.toFixed(2)}`,
    message: preview + more,
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
