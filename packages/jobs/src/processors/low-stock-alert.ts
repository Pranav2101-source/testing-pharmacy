import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";
import { inAppNotify } from "@pharmacy/mailer";

type LowStockRow = { medicineName: string; batchNumber: string; quantity: number; minimumStock: number };

async function processPharmacy(pharmacyId: string): Promise<void> {
  const pharmacy = await prisma.pharmacy.findUnique({
    where:  { id: pharmacyId },
    select: { id: true, name: true },
  });
  if (!pharmacy) return;

  const ALERT_LIMIT = 200;
  const lowStock = await prisma.$queryRaw<LowStockRow[]>`
    SELECT m.name AS "medicineName", i."batchNumber", i.quantity, i."minimumStock"
    FROM inventory i
    JOIN medicines m ON i."medicineId" = m.id
    WHERE i."pharmacyId" = ${pharmacy.id}
      AND i.status = 'ACTIVE'
      AND i.quantity <= i."minimumStock"
    ORDER BY i.quantity ASC
    LIMIT ${ALERT_LIMIT}
  `;

  if (lowStock.length === 0) return;
  const truncated  = lowStock.length === ALERT_LIMIT;
  const outOfStock = lowStock.filter((i) => i.quantity === 0);
  const low        = lowStock.filter((i) => i.quantity > 0);

  // In-app notification — concise breakdown for the bell
  const inAppLines: string[] = [];
  if (outOfStock.length > 0) inAppLines.push(`⛔ ${outOfStock.length} item${outOfStock.length !== 1 ? "s" : ""} out of stock`);
  if (low.length > 0)        inAppLines.push(`🟡 ${low.length} item${low.length !== 1 ? "s" : ""} below minimum stock`);
  if (truncated)             inAppLines.push(`⚠️ Showing first 200 — open app for full list`);

  await inAppNotify(prisma, pharmacy.id, {
    subject: `Stock Alert: ${lowStock.length}${truncated ? "+" : ""} item(s) need restocking`,
    message: inAppLines.join("\n"),
  });

  console.info(`[low-stock-alert][${pharmacy.name}] sent alert: ${lowStock.length} items`);
}

export async function lowStockAlertHandler(_jobs: Job[]): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    where:  { isActive: true },
    select: { id: true },
  });

  const results = await Promise.allSettled(pharmacies.map((p) => processPharmacy(p.id)));
  const failed  = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[low-stock-alert] ${failed.length}/${pharmacies.length} pharmacies failed`);
    for (const f of failed) {
      if (f.status === "rejected") console.error("[low-stock-alert] error:", f.reason);
    }
  }
}
