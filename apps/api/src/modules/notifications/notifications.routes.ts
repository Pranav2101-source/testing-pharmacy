import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

// WhatsApp/SMS notifications are paused — this module is a placeholder
const notificationsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolveTenant];

  app.get("/logs", { preHandler }, async (req, reply) => {
    const logs = await app.prisma.notificationLog.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send({ success: true, data: logs });
  });
};

export default notificationsRoutes;
