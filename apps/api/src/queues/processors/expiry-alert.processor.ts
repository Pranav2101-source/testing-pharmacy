import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection, expiryAlertQueue } from "../queue.client.js";
import { notifyOwners } from "../../lib/notifications.js";
import { onWorkerFailed } from "../on-worker-failed.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

export const expiryAlertWorker = new Worker(
  "expiry-alerts",
  async (job) => {
    const { pharmacyId } = job.data as { pharmacyId?: string };

    // Dispatch mode — enqueue one child job per active pharmacy so each
    // runs independently. A single slow/failing pharmacy can't stall others.
    if (!pharmacyId) {
      const pharmacies = await prisma.pharmacy.findMany({
        where:  { isActive: true },
        select: { id: true },
      });
      await Promise.all(
        pharmacies.map((p) =>
          expiryAlertQueue.add(`pharmacy:${p.id}`, { pharmacyId: p.id }, {
            removeOnComplete: { count: 1 },
            removeOnFail:     { count: 3 },
          }),
        ),
      );
      job.log(`Dispatched ${pharmacies.length} expiry-alert job(s)`);
      return;
    }

    // Process mode — handle a single pharmacy
    const pharmacy = await prisma.pharmacy.findUnique({
      where:  { id: pharmacyId },
      select: { id: true, name: true },
    });
    if (!pharmacy) return;

    const threshold = new Date(Date.now() + 90 * DAY_MS);
    const expiring  = await prisma.inventory.findMany({
      where: {
        pharmacyId: pharmacy.id,
        expiryDate: { lte: threshold },
        quantity:   { gt: 0 },
        status:     "ACTIVE",
      },
      include: { medicine: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    });

    if (expiring.length === 0) return;

    const message =
      `Expiry Alert — ${pharmacy.name}\n\n` +
      expiring
        .map((i) => {
          const d = daysUntil(i.expiryDate);
          return `${i.medicine.name} | Batch: ${i.batchNumber} | ${i.expiryDate.toISOString().split("T")[0]} | Qty: ${i.quantity} | ${d <= 0 ? "EXPIRED" : `${d}d left`}`;
        })
        .join("\n");

    await notifyOwners(prisma, pharmacy.id, {
      subject: `Expiry Alert: ${expiring.length} batch(es) — ${pharmacy.name}`,
      message,
      html:    buildHtml(expiring, pharmacy.name),
    });

    job.log(`[${pharmacy.name}] expiry alert sent: ${expiring.length} items`);
  },
  { connection, concurrency: 5 },
);
onWorkerFailed(expiryAlertWorker);
