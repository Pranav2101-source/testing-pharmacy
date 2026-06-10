import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection, quotationExpiryQueue } from "../queue.client.js";
import { onWorkerFailed } from "../on-worker-failed.js";
import { notifyOwners } from "../../lib/notifications.js";

export const quotationExpiryWorker = new Worker(
  "quotation-expiry",
  async (job) => {
    const { pharmacyId } = job.data as { pharmacyId?: string };

    if (!pharmacyId) {
      const pharmacies = await prisma.pharmacy.findMany({
        where:  { isActive: true },
        select: { id: true },
      });
      await Promise.all(
        pharmacies.map((p) =>
          quotationExpiryQueue.add(`pharmacy:${p.id}`, { pharmacyId: p.id }, {
            removeOnComplete: { count: 1 },
            removeOnFail:     { count: 3 },
          }),
        ),
      );
      job.log(`Dispatched ${pharmacies.length} quotation-expiry job(s)`);
      return;
    }

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

    const message = `${expiring.length} quotation(s) expiring within 2 days:\n\n${lines}\n\nConvert to Purchase Order before they expire.`;

    await notifyOwners(prisma, pharmacy.id, {
      subject: `⏰ ${expiring.length} Quotation(s) Expiring Soon — ${pharmacy.name}`,
      message,
    });

    job.log(`[${pharmacy.name}] quotation-expiry alert: ${expiring.length} quotations`);
  },
  { connection, concurrency: 5 },
);
onWorkerFailed(quotationExpiryWorker);
