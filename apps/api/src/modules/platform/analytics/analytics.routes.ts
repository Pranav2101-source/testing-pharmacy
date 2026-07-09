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
    const query = req.query as { from?: string; to?: string; format?: "csv" | "xlsx" };
    
    if (!query.from || !query.to) {
      return reply.status(400).send({ success: false, message: "Missing from and to dates" });
    }

    // Parse explicitly in IST timezone (UTC+5:30)
    // Anchor startDate to exactly 00:00:00.000 IST
    // Shift endDate to exactly 23:59:59.999 IST
    const fromDate = new Date(`${query.from}T00:00:00.000+05:30`);
    const toDate = new Date(`${query.to}T23:59:59.999+05:30`);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return reply.status(400).send({ success: false, message: "Invalid date format" });
    }

    // Enforce 1-year max range
    const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 3600 * 24);
    if (daysDiff > 366) {
      return reply.status(400).send({ success: false, message: "Export range cannot exceed 1 year" });
    }
    
    const format = query.format === "xlsx" ? "xlsx" : "csv";
    
    const { content, filename, contentType } = await service.exportDashboardData({ from: fromDate, to: toDate }, format);
    
    // Log export to Audit Log
    try {
      await app.prisma.auditLog.create({
        data: {
          action: "EXPORT",
          module: "ANALYTICS",
          severity: "INFO",
          status: "SUCCESS",
          userEmail: req.user.email,
          resourceName: "Platform Analytics Report",
          entity: "Export",
          newData: { from: fromDate, to: toDate, format }
        }
      });
    } catch (e) {
      req.log.error("Failed to write audit log for analytics export");
    }
    
    reply.header("Content-Type", contentType);
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(content);
  });

  app.get("/new-pharmacies", { preHandler: adminAuth }, async (req, reply) => {
    const query = req.query as {
      days?: string;
      page?: string;
      limit?: string;
      search?: string;
      plan?: string;
      status?: string;
      sort?: string;
    };
    
    let days = parseInt(query.days || "30", 10);
    if (isNaN(days) || days < 1) days = 1;
    if (days > 365) days = 365;

    let page = parseInt(query.page || "1", 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(query.limit || "10", 10);
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const data = await service.getNewPharmacies({
      days,
      page,
      limit,
      search: query.search,
      plan: query.plan,
      status: query.status,
      sort: query.sort
    });

    return reply.send({ success: true, data });
  });

  app.get("/new-pharmacies/export", { preHandler: adminAuth }, async (req, reply) => {
    const query = req.query as {
      days?: string;
      search?: string;
      plan?: string;
      status?: string;
      sort?: string;
    };
    
    let days = parseInt(query.days || "30", 10);
    if (isNaN(days) || days < 1) days = 1;
    if (days > 365) days = 365;

    const { content, filename, contentType } = await service.exportNewPharmacies({
      days,
      search: query.search,
      plan: query.plan,
      status: query.status,
      sort: query.sort
    });

    reply.header("Content-Type", contentType);
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(content);
  });

  app.get("/activity", { preHandler: adminAuth }, async (req, reply) => {
    // Basic paginated activity response
    const dashboard = await service.getDashboard({ from: new Date(0), to: new Date() }, false);
    return reply.send({ success: true, data: { items: dashboard.activity, total: dashboard.activity.length } });
  });
};

export default analyticsRoutes;
