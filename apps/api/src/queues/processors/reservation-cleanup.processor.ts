import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection } from "../queue.client.js";
import { onWorkerFailed } from "../on-worker-failed.js";

// Cleans up StockReservation rows whose TTL has passed and restores
// the corresponding reservedQuantity on inventory.
//
// Why this is needed: reservations are released opportunistically inside
// upsertReservations (triggered when a new billing session starts) and
// atomically inside createInvoiceTransactional (triggered when billing
// completes).  A user who abandons their cart without starting a new
// session leaves expired rows in StockReservation and inflated
// reservedQuantity on Inventory until the next billing attempt for
// that pharmacy.  This job runs on a schedule so the column stays
// accurate independent of future billing activity.

export const reservationCleanupWorker = new Worker(
  "reservation-cleanup",
  async (job) => {
    const now = new Date();

    // Find all expired rows in a single query across all pharmacies.
    const expired = await prisma.stockReservation.findMany({
      where:  { expiresAt: { lt: now } },
      select: { id: true, pharmacyId: true, inventoryId: true, quantity: true },
    });

    if (expired.length === 0) {
      job.log("No expired reservations found");
      return;
    }

    // Group by pharmacyId so we can run one raw SQL per pharmacy rather
    // than one UPDATE per row.
    const byPharmacy = new Map<string, { inventoryId: string; quantity: number }[]>();
    for (const r of expired) {
      if (!byPharmacy.has(r.pharmacyId)) byPharmacy.set(r.pharmacyId, []);
      byPharmacy.get(r.pharmacyId)!.push({ inventoryId: r.inventoryId, quantity: r.quantity });
    }

    let totalReleased = 0;

    for (const [pharmacyId, rows] of byPharmacy) {
      const ids  = rows.map((r) => r.inventoryId);
      const qtys = rows.map((r) => r.quantity);

      // Delete the expired rows and decrement reservedQuantity in parallel.
      // GREATEST(0, ...) guards against the column going negative if a
      // concurrent billing transaction already decremented it.
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

    job.log(`Released ${totalReleased} expired reservation(s) across ${byPharmacy.size} pharmacy/pharmacies`);
  },
  { connection, concurrency: 1, drainDelay: 300, stalledInterval: 300_000 },
);
onWorkerFailed(reservationCleanupWorker);
