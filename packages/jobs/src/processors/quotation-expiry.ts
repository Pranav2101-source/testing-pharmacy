import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

async function processPharmacy(pharmacyId: string): Promise<void> {
  const pharmacy = await prisma.pharmacy.findUnique({
    where:  { id: pharmacyId },
    select: { id: true, name: true },
  });
  if (!pharmacy) return;

  const now            = new Date();
  const twoDaysFromNow = new Date(Date.now() + 2 * 86_400_000);

  const expiring = await prisma.quotation.findMany({
    where: {
      pharmacyId: pharmacy.id,
      status:     { in: ["SENT", "RECEIVED"] },
      validUntil: { gte: now, lte: twoDaysFromNow },
    },
    include: {
      supplier: { select: { name: true } },
      _count:   { select: { items: true } },
    },
    orderBy: { validUntil: "asc" },
  });

  if (expiring.length === 0) return;

  const lines = expiring
    .map((q) => {
      const daysLeft = Math.ceil((q.validUntil!.getTime() - now.getTime()) / 86_400_000);
      return `${q.quotationNumber} — ${q.supplier.name} — expires in ${daysLeft}d (${q.validUntil!.toISOString().split("T")[0]})`;
    })
    .join("\n");

  await inAppNotify(prisma, pharmacy.id, {
    subject: `⏰ ${expiring.length} quotation(s) expiring within 2 days`,
    message: `${lines}\n\nConvert to a Purchase Order before they expire.`,
  });

  console.info(`[quotation-expiry][${pharmacy.name}] sent alert: ${expiring.length} quotations`);
}

export async function quotationExpiryHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  const results = await Promise.allSettled(pharmacies.map((p) => processPharmacy(p.id)));
  const failed  = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[quotation-expiry] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[quotation-expiry] error:", f.reason);
    }
  }
}
