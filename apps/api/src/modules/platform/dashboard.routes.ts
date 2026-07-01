import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { DashboardService } from "./dashboard.service.js";

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const service = new DashboardService(app);
  
  // Platform Admin only
  const adminAuth = [authenticate, requireRole("PLATFORM_ADMIN")];

  app.get("/stats", { preHandler: adminAuth }, async (_req, reply) => {
    const stats = await service.getPlatformDashboardStats();
    return reply.send({ success: true, data: stats });
  });
};

export default dashboardRoutes;
