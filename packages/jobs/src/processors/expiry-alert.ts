import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { notifyOwners, inAppNotify } from "@pharmacy/mailer";

const DAY_MS = 24 * 60 * 60 * 1_000;

type ExpiryItem = {
  medicine: { name: string };
  batchNumber: string;
  expiryDate: Date;
  quantity: number;
};

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / DAY_MS);
}

function buildHtml(items: ExpiryItem[], pharmacyName: string): string {
  const now      = new Date();
  const expired  = items.filter((i) => daysUntil(i.expiryDate) <= 0);
  const critical = items.filter((i) => { const d = daysUntil(i.expiryDate); return d > 0 && d <= 30; });
  const warning  = items.filter((i) => { const d = daysUntil(i.expiryDate); return d > 30 && d <= 60; });
  const notice   = items.filter((i) => daysUntil(i.expiryDate) > 60);

  const rows = (list: ExpiryItem[], color: string) =>
    list.map((i) => {
      const days  = daysUntil(i.expiryDate);
      const label = days <= 0 ? "EXPIRED" : `${days}d left`;
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.medicine.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.batchNumber}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.expiryDate.toISOString().split("T")[0]}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${color};font-weight:600">${label}</td>
      </tr>`;
    }).join("");

  const section = (title: string, color: string, list: ExpiryItem[]) =>
    list.length === 0 ? "" : `
      <h3 style="color:${color};margin:24px 0 8px">${title} (${list.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:8px 10px;text-align:left">Medicine</th>
          <th style="padding:8px 10px;text-align:left">Batch</th>
          <th style="padding:8px 10px;text-align:left">Expiry Date</th>
          <th style="padding:8px 10px;text-align:center">Qty</th>
          <th style="padding:8px 10px;text-align:left">Status</th>
        </tr></thead>
        <tbody>${rows(list, color)}</tbody>
      </table>`;

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
    <h2 style="color:#1a1a1a">Expiry Alert — ${pharmacyName}</h2>
    <p style="color:#555">Report: ${now.toLocaleDateString("en-IN")} &nbsp;|&nbsp; <strong>${items.length} batch(es)</strong> need attention.</p>
    ${section("⛔ Already Expired", "#dc2626", expired)}
    ${section("🔴 Critical — within 30 days", "#dc2626", critical)}
    ${section("🟡 Warning — 31–60 days", "#d97706", warning)}
    ${section("🔵 Notice — 61–90 days", "#2563eb", notice)}
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

  const message =
    `Expiry Alert — ${pharmacy.name}\n\n` +
    allItems
      .map((i) => {
        const d = daysUntil(i.expiryDate);
        return `${i.medicine.name} | Batch: ${i.batchNumber} | ${i.expiryDate.toISOString().split("T")[0]} | Qty: ${i.quantity} | ${d <= 0 ? "EXPIRED" : `${d}d left`}`;
      })
      .join("\n");

  await notifyOwners(prisma, pharmacy.id, {
    subject: `Expiry Alert: ${allItems.length} batch(es) — ${pharmacy.name}`,
    message,
    html:    buildHtml(allItems, pharmacy.name),
  });

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
