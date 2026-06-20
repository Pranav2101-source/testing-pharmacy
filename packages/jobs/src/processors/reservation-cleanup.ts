import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";

// Cleans up StockReservation rows whose TTL has passed and restores
// the corresponding reservedQuantity on inventory.
//
// Runs hourly. Reservations are also released opportunistically inside
// upsertReservations (new billing session) and atomically inside
// createInvoiceTransactional (billing completes). This job covers
// abandoned carts that never triggered either path.
export async function reservationCleanupHandler(_jobs: Job[]): Promise<void> {
  const now = new Date();

  const expired = await prisma.stockReservation.findMany({
    where:  { expiresAt: { lt: now } },
    select: { id: true, pharmacyId: true, inventoryId: true, quantity: true },
  });

  if (expired.length === 0) return;

  const byPharmacy = new Map<string, { inventoryId: string; quantity: number }[]>();
  for (const r of expired) {
    if (!byPharmacy.has(r.pharmacyId)) byPharmacy.set(r.pharmacyId, []);
    byPharmacy.get(r.pharmacyId)!.push({ inventoryId: r.inventoryId, quantity: r.quantity });
  }

  let totalReleased = 0;

  for (const [pharmacyId, rows] of byPharmacy) {
    const ids  = rows.map((r) => r.inventoryId);
    const qtys = rows.map((r) => r.quantity);

    // GREATEST(0, …) guards against going negative if a concurrent billing
    // transaction already decremented reservedQuantity.
    await prisma.$transaction([
      prisma.stockReservation.deleteMany({
        where: { pharmacyId, expiresAt: { lt: now } },
      }),
      prisma.$executeRaw`
        UPDATE inventory inv
        SET    "reservedQuantity" = GREATEST(0, inv."reservedQuantity" - b.qty)
        FROM   (SELECT unnest(${ids}::text[]) AS id, unnest(${qtys}::int[]) AS qty) AS b
        WHERE  inv.id           = b.id
          AND  inv."pharmacyId" = ${pharmacyId}::text
      `,
    ]);

    totalReleased += rows.length;
  }

  console.info(`[reservation-cleanup] released ${totalReleased} reservation(s) across ${byPharmacy.size} pharmacy/pharmacies`);
}
