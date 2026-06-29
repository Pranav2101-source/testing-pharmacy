import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

const DAY_MS = 24 * 60 * 60 * 1_000;

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / DAY_MS);
}

async function processPharmacy(pharmacyId: string): Promise<void> {
  const pharmacy = await prisma.pharmacy.findUnique({
    where:  { id: pharmacyId },
    select: { id: true, name: true },
  });
  if (!pharmacy) return;

  const now       = new Date();
  const threshold = new Date(Date.now() + 90 * DAY_MS);

  const { count: expiredCount } = await prisma.inventory.updateMany({
    where: { pharmacyId: pharmacy.id, status: "ACTIVE", expiryDate: { lt: now } },
    data:  { status: "EXPIRED" },
  });
  if (expiredCount > 0) {
    console.info(`[expiry-alert][${pharmacy.name}] auto-expired ${expiredCount} batch(es)`);
  }

  const expiring = await prisma.inventory.findMany({
    where: {
      pharmacyId: pharmacy.id,
      expiryDate: { gte: now, lte: threshold },
      quantity:   { gt: 0 },
      status:     "ACTIVE",
    },
    include: { medicine: { select: { name: true } } },
    orderBy: { expiryDate: "asc" },
  });

  const alreadyExpired = await prisma.inventory.findMany({
    where: { pharmacyId: pharmacy.id, status: "EXPIRED", quantity: { gt: 0 } },
    include: { medicine: { select: { name: true } } },
    orderBy: { expiryDate: "asc" },
  });

  const allItems = [...alreadyExpired, ...expiring];
  if (allItems.length === 0) return;

  // In-app notification — tier breakdown so staff sees severity at a glance
  const tierExpired   = alreadyExpired.length;
  const tierCritical  = expiring.filter((i) => daysUntil(i.expiryDate) <= 30).length;
  const tierWarning   = expiring.filter((i) => { const d = daysUntil(i.expiryDate); return d > 30 && d <= 60; }).length;
  const tierNotice    = expiring.filter((i) => daysUntil(i.expiryDate) > 60).length;

  const lines: string[] = [];
  if (tierExpired  > 0) lines.push(`⛔ ${tierExpired} already expired`);
  if (tierCritical > 0) lines.push(`🔴 ${tierCritical} expiring within 30 days`);
  if (tierWarning  > 0) lines.push(`🟡 ${tierWarning} expiring within 60 days`);
  if (tierNotice   > 0) lines.push(`🔵 ${tierNotice} expiring within 90 days`);

  await inAppNotify(prisma, pharmacy.id, {
    subject: `Expiry Alert: ${allItems.length} batch(es) need attention`,
    message: lines.join("\n"),
  });

  console.info(`[expiry-alert][${pharmacy.name}] sent alert: ${allItems.length} items`);
}

export async function expiryAlertHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  const results = await Promise.allSettled(pharmacies.map((p) => processPharmacy(p.id)));
  const failed  = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[expiry-alert] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[expiry-alert] error:", f.reason);
    }
  }
}
