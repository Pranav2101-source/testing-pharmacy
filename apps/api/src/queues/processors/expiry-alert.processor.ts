import { Worker } from "bullmq";
import { prisma } from "@pharmacy/database";
import { connection } from "../queue.client.js";

export const expiryAlertWorker = new Worker(
  "expiry-alerts",
  async (job) => {
    const { tenantId } = job.data as { tenantId: string };
    const threshold = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const expiring = await prisma.inventory.findMany({
      where: { tenantId, expiryDate: { lte: threshold }, quantity: { gt: 0 } },
      include: { medicine: { select: { name: true } } },
    });

    // TODO: send notifications when WhatsApp module is enabled
    job.log(`Found ${expiring.length} expiring items for tenant ${tenantId}`);
  },
  { connection }
);
