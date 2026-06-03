import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection } from "../queue.client.js";
import { notifyOwners } from "../../lib/notifications.js";

export const quotationExpiryWorker = new Worker(
  "quotation-expiry",
  async (job) => {
    const twoDaysFromNow = new Date(Date.now() + 2 * 86_400_000);
    const now            = new Date();

    const pharmacies = await prisma.pharmacy.findMany({
      where:  { isActive: true },
      select: { id: true, name: true },
    });

    for (const pharmacy of pharmacies) {
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

      if (expiring.length === 0) continue;

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
    }
  },
  { connection },
);
