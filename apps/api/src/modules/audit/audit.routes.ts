import type { FastifyPluginAsync } from "fastify";
import { requireOwner } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const auditRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [requireOwner, resolveTenant];

  app.get("/", { preHandler }, async (req, reply) => {
    const { page = "1", limit = "50", entity } = req.query as Record<string, string>;
    const [items, total] = await Promise.all([
      app.prisma.auditLog.findMany({
        where: {
          tenantId: req.tenantId,
          ...(entity ? { entity } : {}),
        },
        orderBy: { createdAt: "desc" },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { user: { select: { name: true, email: true } } },
      }),
      app.prisma.auditLog.count({ where: { tenantId: req.tenantId } }),
    ]);
    return reply.send({ success: true, data: { items, total } });
  });
};

export default auditRoutes;
