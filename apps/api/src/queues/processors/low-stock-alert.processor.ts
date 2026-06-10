import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection, lowStockAlertQueue } from "../queue.client.js";
import { onWorkerFailed } from "../on-worker-failed.js";
import { notifyOwners } from "../../lib/notifications.js";

type LowStockRow = { medicineName: string; batchNumber: string; quantity: number; minimumStock: number };

function buildHtml(outOfStock: LowStockRow[], low: LowStockRow[], pharmacyName: string): string {
  const rows = (items: LowStockRow[], label: string, color: string) =>
    items.map((i) =>
      `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.medicineName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.batchNumber}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${color};font-weight:600">${i.quantity}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${i.minimumStock}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${color}">${label}</td>
      </tr>`,
    ).join("");

  const table = (items: LowStockRow[], title: string, color: string) =>
    items.length === 0 ? "" : `
      <h3 style="color:${color};margin:20px 0 8px">${title} (${items.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:8px 10px;text-align:left">Medicine</th>
          <th style="padding:8px 10px;text-align:left">Batch</th>
          <th style="padding:8px 10px;text-align:left">Qty</th>
          <th style="padding:8px 10px;text-align:left">Min Stock</th>
          <th style="padding:8px 10px;text-align:left">Status</th>
        </tr></thead>
        <tbody>${rows(items, title.split(" ")[0]!, color)}</tbody>
      </table>`;

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px">
    <h2 style="color:#1a1a1a">Stock Alert — ${pharmacyName}</h2>
    <p style="color:#555">${outOfStock.length + low.length} item(s) need restocking.</p>
    ${table(outOfStock, "⛔ Out of Stock", "#dc2626")}
    ${table(low, "🟡 Low Stock", "#d97706")}
    <hr style="margin-top:32px">
    <p style="color:#888;font-size:12px">Automated alert from Checkup Pharmacy.</p>
  </body></html>`;
}

export const lowStockAlertWorker = new Worker(
  "low-stock-alerts",
  async (job) => {
    const { pharmacyId } = job.data as { pharmacyId?: string };

    if (!pharmacyId) {
      const pharmacies = await prisma.pharmacy.findMany({
        where:  { isActive: true },
        select: { id: true },
      });
      await Promise.all(
        pharmacies.map((p) =>
          lowStockAlertQueue.add(`pharmacy:${p.id}`, { pharmacyId: p.id }, {
            removeOnComplete: { count: 1 },
            removeOnFail:     { count: 3 },
          }),
        ),
      );
      job.log(`Dispatched ${pharmacies.length} low-stock-alert job(s)`);
      return;
    }

    const pharmacy = await prisma.pharmacy.findUnique({
      where:  { id: pharmacyId },
      select: { id: true, name: true },
    });
    if (!pharmacy) return;

    const lowStock = await prisma.$queryRaw<LowStockRow[]>`
      SELECT m.name AS "medicineName", i."batchNumber", i.quantity, i."minimumStock"
      FROM inventory i
      JOIN medicines m ON i."medicineId" = m.id
      WHERE i."pharmacyId" = ${pharmacy.id}
        AND i.status = 'ACTIVE'
        AND i.quantity <= i."minimumStock"
      ORDER BY i.quantity ASC
      LIMIT 50
    `;

    if (lowStock.length === 0) return;

    const outOfStock = lowStock.filter((i) => i.quantity === 0);
    const low        = lowStock.filter((i) => i.quantity > 0);

    const lines = [
      outOfStock.length > 0
        ? `OUT OF STOCK: ${outOfStock.map((i) => i.medicineName).join(", ")}`
        : "",
      low.length > 0
        ? `LOW STOCK: ${low.map((i) => `${i.medicineName} (${i.quantity} left)`).join(", ")}`
        : "",
    ].filter(Boolean).join("\n\n");

    await notifyOwners(prisma, pharmacy.id, {
      subject: `Stock Alert: ${lowStock.length} item(s) need restocking — ${pharmacy.name}`,
      message: `Stock Alert for ${pharmacy.name}\n\n${lines}`,
      html:    buildHtml(outOfStock, low, pharmacy.name),
    });

    job.log(`[${pharmacy.name}] low-stock alert sent for ${lowStock.length} items`);
  },
  { connection, concurrency: 5 },
);
onWorkerFailed(lowStockAlertWorker);
