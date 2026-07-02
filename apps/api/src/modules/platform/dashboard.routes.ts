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

  app.get("/export", { preHandler: adminAuth }, async (_req, reply) => {
    const csvContent = await service.exportDashboardReport();
    
    const today = new Date().toISOString().split('T')[0];
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename=platform-report-${today}.csv`);
    
    return reply.send(csvContent);
  });
};

export default dashboardRoutes;
