import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { ReportsService } from "./reports.service.js";
import {
  parsePeriod,
  dailySalesQuerySchema,
  expiryQuerySchema,
  costAnalysisQuerySchema,
  scheduleHQuerySchema,
  fastMovingQuerySchema,
  slowMovingQuerySchema,
  deadStockQuerySchema,
  valuationQuerySchema,
} from "./reports.schema.js";

const reportsRoutes: FastifyPluginAsync = async (app) => {
  const service    = new ReportsService(app);
  const preHandler = [authenticate, resolvePharmacy];

  // ── Sales ──────────────────────────────────────────────────────────────────

  app.get("/sales/daily", { preHandler }, async (req, reply) => {
    const { date } = dailySalesQuerySchema.parse(req.query);
    const data = await service.dailySales(req.pharmacyId, date);
    return reply.send({ success: true, data });
  });

  app.get("/gst", { preHandler }, async (req, reply) => {
    const period = parsePeriod(req.query);
    const data = await service.gstSummary(req.pharmacyId, period);
    return reply.send({ success: true, data });
  });

  app.get("/expiry", { preHandler }, async (req, reply) => {
    const { days, limit } = expiryQuerySchema.parse(req.query);
    const data = await service.expiryReport(req.pharmacyId, days, limit);
    return reply.send({ success: true, data });
  });

  // ── Purchase analytics (#22, #28) ──────────────────────────────────────────

  app.get("/purchases/summary", { preHandler }, async (req, reply) => {
    const period = parsePeriod(req.query);
    const data = await service.purchaseSummary(req.pharmacyId, period);
    return reply.send({ success: true, data });
  });

  app.get("/purchases/cost-analysis", { preHandler }, async (req, reply) => {
    const period    = parsePeriod(req.query);
    const { limit } = costAnalysisQuerySchema.parse(req.query);
    const data = await service.costAnalysis(req.pharmacyId, period, limit);
    return reply.send({ success: true, data });
  });

  // ── Schedule H register (#30) ──────────────────────────────────────────────

  app.get("/schedule-h", { preHandler }, async (req, reply) => {
    const period       = parsePeriod(req.query);
    const { schedule } = scheduleHQuerySchema.parse(req.query);
    const data = await service.scheduleRegister(req.pharmacyId, period, schedule);
    return reply.send({ success: true, data });
  });

  // ── GST report CSV export (#31) ────────────────────────────────────────────

  app.get("/gst/export", { preHandler }, async (req, reply) => {
    const period = parsePeriod(req.query);
    const { csv, filename } = await service.gstExportCsv(req.pharmacyId, period);
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csv);
  });

  // ── GSTR-1 HSN summary ────────────────────────────────────────────────────

  app.get("/gst/hsn-summary", { preHandler }, async (req, reply) => {
    const period = parsePeriod(req.query);
    const data   = await service.hsnSummary(req.pharmacyId, period);
    return reply.send({ success: true, data });
  });

  app.get("/gst/hsn-summary/export", { preHandler }, async (req, reply) => {
    const period = parsePeriod(req.query);
    const { csv, filename } = await service.hsnSummaryCsv(req.pharmacyId, period);
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csv);
  });

  // ── Fast/slow-moving analysis (#32) ────────────────────────────────────────

  app.get("/analytics/fast-moving", { preHandler }, async (req, reply) => {
    const period    = parsePeriod(req.query);
    const { limit } = fastMovingQuerySchema.parse(req.query);
    const data = await service.fastMoving(req.pharmacyId, period, limit);
    return reply.send({ success: true, data });
  });

  app.get("/analytics/slow-moving", { preHandler }, async (req, reply) => {
    const period          = parsePeriod(req.query);
    const { limit, minQty } = slowMovingQuerySchema.parse(req.query);
    const data = await service.slowMoving(req.pharmacyId, period, limit, minQty);
    return reply.send({ success: true, data });
  });

  // ── Dead stock (#33) ───────────────────────────────────────────────────────

  app.get("/analytics/dead-stock", { preHandler }, async (req, reply) => {
    const { days } = deadStockQuerySchema.parse(req.query);
    const data = await service.deadStock(req.pharmacyId, days);
    return reply.send({ success: true, data });
  });

  // ── Inventory valuation (#34) ──────────────────────────────────────────────

  app.get("/inventory/valuation", { preHandler }, async (req, reply) => {
    const { groupBy } = valuationQuerySchema.parse(req.query);
    const data = await service.inventoryValuation(req.pharmacyId, groupBy);
    return reply.send({ success: true, data });
  });

  // ── EOD summary ────────────────────────────────────────────────────────────

  app.get("/eod/summary", { preHandler }, async (req, reply) => {
    const data = await service.eodSummary(req.pharmacyId);
    return reply.send({ success: true, data });
  });
};

export default reportsRoutes;
