import type { Job } from "pg-boss";
import { prisma } from "@pharmacy/database";

export async function auditWorkerHandler(input: Job | Job[]): Promise<void> {
  const jobs = Array.isArray(input) ? input : [input];

  for (const job of jobs) {
    const data = job.data as {
      pharmacyId?: string | null;
      userId?: string | null;
      userEmail?: string | null;
      module: any;
      action: string;
      entity: string;
      entityId?: string | null;
      resourceName?: string | null;
      oldData?: any;
      newData?: any;
      severity?: any;
      status?: any;
      ipAddress?: string | null;
      userAgent?: string | null;
      requestId?: string | null;
    };

    try {
      await prisma.auditLog.create({
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
      console.error("[audit-worker] error processing audit log", err, data);
      throw err;
    }
  }
}
