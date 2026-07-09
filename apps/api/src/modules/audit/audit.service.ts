import type { FastifyRequest } from "fastify";
import type { AuditModule, AuditSeverity, AuditStatus } from "@pharmacy/database";
import { boss } from "@pharmacy/jobs";

export type AuditLogInput = {
  pharmacyId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  module: AuditModule;
  action: string;
  entity: string;
  entityId?: string | null;
  resourceName?: string | null;
  oldData?: Record<string, any> | null;
  newData?: Record<string, any> | null;
  severity?: AuditSeverity;
  status?: AuditStatus;
};

class AuditService {
  /**
   * Logs an audit event durably via pg-boss without blocking the request.
   */
  async log(req: FastifyRequest | null, data: AuditLogInput): Promise<void> {
    try {
      let ipAddress = req?.ip ?? null;
      let userAgent = req?.headers["user-agent"] ?? null;
      let requestId = req?.id ?? null;

      // Extract from auth metadata if available and not explicitly provided
      let userId = data.userId;
      let pharmacyId = data.pharmacyId;
      
      if (req && !userId) {
        // req.user might be present depending on auth middleware — the JWT
        // payload's user-id claim is `sub`, not `id` (see JwtPayload in middleware/auth.ts)
        const user = (req as any).user;
        if (user?.sub) userId = user.sub;
      }

      if (req && !pharmacyId) {
        const pId = (req as any).pharmacyId;
        if (pId) pharmacyId = pId;
      }

      const payload = {
        ...data,
        ipAddress,
        userAgent,
        requestId,
        userId: userId ?? null,
        pharmacyId: pharmacyId ?? null,
      };

      // Push to pg-boss queue for asynchronous, durable writing
      await boss.send("audit-log", payload, {
        retryLimit: 3,
        retryBackoff: true,
      });
    } catch (err) {
      // Swallow error to avoid breaking the business transaction
      console.error("Failed to queue audit log", err);
    }
  }
}

export const auditService = new AuditService();
