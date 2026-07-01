import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireRole } from "../../../middleware/auth.js";
import { AnalyticsService } from "./analytics.service.js";
import type { AnalyticsDateRange } from "./analytics.types.js";

const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AnalyticsService(app);
  const adminAuth = [authenticate, requireRole("PLATFORM_ADMIN")];

  app.get("/dashboard", { preHandler: adminAuth }, async (req, reply) => {
    const query = req.query as { from?: string; to?: string; refresh?: string };
    
    // Default to last 30 days if not provided
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
    const refresh = query.refresh === "true";
    
    const range: AnalyticsDateRange = { from, to };
    const dashboard = await service.getDashboard(range, refresh);
    
    return reply.send({ success: true, data: dashboard });
  });

  app.get("/export", { preHandler: adminAuth }, async (req, reply) => {
    // Generate simple CSV of executive stats
    const query = req.query as { from?: string; to?: string };
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
    
    const dashboard = await service.getDashboard({ from, to }, true);
    
    let csv = "Metric,Value,Trend\n";
    for (const kpi of dashboard.executive) {
      csv += `"${kpi.label}","${kpi.formattedValue}","${kpi.change}%"\n`;
    }
    
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="platform-analytics-${from.toISOString().split("T")[0]}.csv"`);
    return reply.send(csv);
  });

  app.get("/activity", { preHandler: adminAuth }, async (req, reply) => {
    // Basic paginated activity response
    const dashboard = await service.getDashboard({ from: new Date(0), to: new Date() }, false);
    return reply.send({ success: true, data: { items: dashboard.activity, total: dashboard.activity.length } });
  });
};

export default analyticsRoutes;
