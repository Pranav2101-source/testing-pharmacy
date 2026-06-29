import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

async function processPharmacy(pharmacyId: string): Promise<void> {
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
    customerName: inv.customer?.name ?? "Walk-in",
    totalAmount:  inv.totalAmount,
    ageDays:      Math.floor((now.getTime() - inv.createdAt.getTime()) / 86_400_000),
  }));

  const total   = rows.reduce((s, r) => s + r.totalAmount, 0);
  const preview = rows.slice(0, 3).map((r) => `• ${r.customerName} — ₹${r.totalAmount.toFixed(2)} (${r.ageDays}d old)`).join("\n");
  const more    = rows.length > 3 ? `\n…and ${rows.length - 3} more` : "";

  await inAppNotify(prisma, pharmacy.id, {
    subject: `Weekly Digest: ${pending.length} unpaid — ₹${total.toFixed(2)} pending credit`,
    message: preview + more,
  });

  console.info(`[pending-credit][${pharmacy.name}] sent: ${pending.length} invoices ₹${total.toFixed(2)}`);
}

export async function pendingCreditHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  const results = await Promise.allSettled(pharmacies.map((p) => processPharmacy(p.id)));
  const failed  = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[pending-credit] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[pending-credit] error:", f.reason);
    }
  }
}
