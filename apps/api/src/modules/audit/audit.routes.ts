import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const auditRoutes: FastifyPluginAsync = async (app) => {
  // Audit logs are sensitive — restrict to owners only
  const preHandler = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler }, async (req, reply) => {
    const { page = "1", limit = "50", entity } = req.query as Record<string, string>;

    const [items, total] = await Promise.all([
      app.prisma.auditLog.findMany({
        where: {
          pharmacyId: req.pharmacyId,
          ...(entity ? { entity } : {}),
        },
        orderBy: { createdAt: "desc" },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
        include: { user: { select: { name: true, email: true } } },
      }),
      app.prisma.auditLog.count({ where: { pharmacyId: req.pharmacyId } }),
    ]);

    return reply.send({ success: true, data: { items, total } });
  });
};

export default auditRoutes;
