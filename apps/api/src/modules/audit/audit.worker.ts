import type { FastifyInstance } from "fastify";
import type { AuditLogInput } from "./audit.service.js";

export async function setupAuditWorker(app: FastifyInstance) {
  if (!app.boss) {
    app.log.warn("pg-boss not initialized, skipping audit worker setup");
    return;
  }

  app.log.info("Setting up audit worker...");

  await app.boss.work("audit-log", async (job) => {
    const data = job.data as AuditLogInput & {
      ipAddress: string | null;
      userAgent: string | null;
      requestId: string | null;
    };

    try {
      await app.prisma.auditLog.create({
        data: {
          pharmacyId: data.pharmacyId ?? null,
          userId: data.userId ?? null,
          userEmail: data.userEmail ?? null,
          module: data.module,
          action: data.action,
          entity: data.entity,
          entityId: data.entityId ?? null,
          resourceName: data.resourceName ?? null,
          oldData: data.oldData ?? null,
          newData: data.newData ?? null,
          severity: data.severity ?? "INFO",
          status: data.status ?? "SUCCESS",
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ?? null,
          requestId: data.requestId ?? null,
        },
      });
    } catch (err) {
      app.log.error({ err, job }, "Failed to process audit log job");
      throw err;
    }
  });
}
