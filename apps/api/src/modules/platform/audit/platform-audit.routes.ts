import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireRole } from "../../../middleware/auth.js";
import { z } from "zod";
import { Readable } from "stream";

const auditQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  module: z.string().optional(),
  action: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const platformAuditRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, requireRole("PLATFORM_ADMIN")];

  app.get("/", { preHandler }, async (req, reply) => {
    const query = auditQuerySchema.parse(req.query);

    const where: any = {};

    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if (query.severity) where.severity = query.severity;
    if (query.status) where.status = query.status;
    
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    if (query.search) {
      where.OR = [
        { resourceName: { contains: query.search, mode: "insensitive" } },
        { entityId: { contains: query.search, mode: "insensitive" } },
        { userEmail: { contains: query.search, mode: "insensitive" } },
        { user: { name: { contains: query.search, mode: "insensitive" } } },
        { pharmacy: { name: { contains: query.search, mode: "insensitive" } } },
      ];
    }

    const [items, total] = await Promise.all([
      app.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
          pharmacy: { select: { id: true, name: true } },
        },
      }),
      app.prisma.auditLog.count({ where }),
    ]);

    return reply.send({ success: true, data: { items, total } });
  });

  app.get("/kpis", { preHandler }, async (req, reply) => {
    // A simplified KPI aggregation for the dashboard.
    // In production, we'd cache this in Redis.
    const query = auditQuerySchema.parse(req.query);
    
    const where: any = {};
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [totalEvents, failedActions, securityAlerts, loginEvents] = await Promise.all([
      app.prisma.auditLog.count({ where }),
      app.prisma.auditLog.count({ where: { ...where, status: "FAILED" } }),
      app.prisma.auditLog.count({ where: { ...where, severity: { in: ["WARNING", "ERROR", "CRITICAL"] } } }),
      app.prisma.auditLog.count({ where: { ...where, action: { contains: "LOGIN" } } }),
    ]);

    return reply.send({
      success: true,
      data: {
        totalEvents,
        failedActions,
        securityAlerts,
        loginEvents,
      },
    });
  });

  app.get("/export", { preHandler }, async (req, reply) => {
    // Export route for platform admin
    const query = auditQuerySchema.parse(req.query);
    const where: any = {};
    
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if ((query as any).userId) where.userId = (query as any).userId;

    async function* generateAuditCsv() {
      yield "ID,Date,Tenant,User,Module,Action,Target,Severity,Status,IP Address\n";
      let cursor: string | undefined = undefined;
      
      while (true) {
        const items = await app.prisma.auditLog.findMany({
          where,
          take: 1000,
          skip: cursor ? 1 : 0,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: { id: "asc" },
          include: {
            user: { select: { name: true, email: true } },
            pharmacy: { select: { name: true } },
          },
        }) as any[];

        if (items.length === 0) break;

        let chunk = "";
        for (const item of items) {
          chunk += `"${item.id}","${item.createdAt.toISOString()}","${item.pharmacy?.name || 'Platform'}","${item.userEmail || item.user?.email || 'System'}","${item.module}","${item.action}","${item.resourceName || item.entityId || ''}","${item.severity}","${item.status}","${item.ipAddress || ''}"\n`;
        }
        yield chunk;
        cursor = items[items.length - 1].id;
      }
    }

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="platform-audit-${new Date().toISOString().split("T")[0]}.csv"`);
    return reply.send(Readable.from(generateAuditCsv()));
  });

  app.get("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const log = await app.prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        pharmacy: { select: { id: true, name: true } },
      },
    });

    if (!log) {
      return reply.status(404).send({ success: false, error: "Audit log not found" });
    }

    return reply.send({ success: true, data: log });
  });

  app.get("/timeline", { preHandler }, async (req, reply) => {
    // Fetch timeline by entity and entityId
    const { entity, entityId } = req.query as { entity?: string; entityId?: string };
    
    if (!entity || !entityId) {
      return reply.send({ success: true, data: [] });
    }

    const logs = await app.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return reply.send({ success: true, data: logs });
  });
};

export default platformAuditRoutes;
