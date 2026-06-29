import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { SubscriptionsService } from "./subscriptions.service.js";
import {
  listSubscriptionsQuerySchema,
  getSubscriptionParamsSchema,
  changePlanSchema,
  bulkSubscriptionActionSchema,
  exportSubscriptionsQuerySchema,
} from "./subscriptions.schema.js";

const subscriptionsRoutes: FastifyPluginAsync = async (app) => {
  const service = new SubscriptionsService(app);
  const adminAuth = [authenticate, requireRole("PLATFORM_ADMIN")];

  // ── Stats ───────────────────────────────────────────────────────────────────

  app.get("/stats", { preHandler: adminAuth }, async (_req, reply) => {
    const stats = await service.getStats();
    return reply.send({ success: true, data: stats });
  });

  // ── Charts ──────────────────────────────────────────────────────────────────

  app.get("/charts", { preHandler: adminAuth }, async (_req, reply) => {
    const charts = await service.getChartData();
    return reply.send({ success: true, data: charts });
  });

  // ── List ────────────────────────────────────────────────────────────────────

  app.get("/", { preHandler: adminAuth }, async (req, reply) => {
    const query = listSubscriptionsQuerySchema.parse(req.query);
    const result = await service.listSubscriptions(query);
    return reply.send({ success: true, ...result });
  });

  // ── Export ──────────────────────────────────────────────────────────────────

  app.get("/export", { preHandler: adminAuth }, async (req, reply) => {
    const query = exportSubscriptionsQuerySchema.parse(req.query);
    const data = await service.exportSubscriptions(query);
    return reply.send({ success: true, data });
  });

  // ── Bulk Actions ────────────────────────────────────────────────────────────

  app.post("/bulk", { preHandler: adminAuth }, async (req, reply) => {
    const { ids, action, planName } = bulkSubscriptionActionSchema.parse(req.body);
    const adminUserId = (req as any).user.id;
    const result = await service.bulkAction(ids, action, adminUserId, planName);
    return reply.send({ success: true, data: result });
  });

  // ── Get Detail ──────────────────────────────────────────────────────────────

  app.get("/:id", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const detail = await service.getDetail(id);
    if (!detail) return reply.status(404).send({ success: false, error: "Subscription not found" });
    return reply.send({ success: true, data: detail });
  });

  // ── Change Plan ─────────────────────────────────────────────────────────────

  app.patch("/:id/plan", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const { planName, billingCycle, amount } = changePlanSchema.parse(req.body);
    const adminUserId = (req as any).user.id;
    const result = await service.changePlan(id, planName, billingCycle, amount, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Renew ───────────────────────────────────────────────────────────────────

  app.post("/:id/renew", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const adminUserId = (req as any).user.id;
    const result = await service.renew(id, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Pause ───────────────────────────────────────────────────────────────────

  app.post("/:id/pause", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const adminUserId = (req as any).user.id;
    const result = await service.pause(id, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Resume ──────────────────────────────────────────────────────────────────

  app.post("/:id/resume", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const adminUserId = (req as any).user.id;
    const result = await service.resume(id, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Cancel ──────────────────────────────────────────────────────────────────

  app.post("/:id/cancel", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const adminUserId = (req as any).user.id;
    const result = await service.cancel(id, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Send Reminder ───────────────────────────────────────────────────────────

  app.post("/:id/reminder", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const adminUserId = (req as any).user.id;
    const result = await service.sendReminder(id, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Generate Invoice ────────────────────────────────────────────────────────

  app.post("/:id/invoice", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const adminUserId = (req as any).user.id;
    const result = await service.generateInvoice(id, adminUserId);
    return reply.send({ success: true, data: result });
  });

  // ── Get Invoices ────────────────────────────────────────────────────────────

  app.get("/:id/invoices", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const data = await service.getInvoices(id);
    return reply.send({ success: true, data });
  });

  // ── Get Usage ───────────────────────────────────────────────────────────────

  app.get("/:id/usage", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    // We need the pharmacyId from the subscription
    const sub = await app.prisma.subscription.findUnique({ where: { id }, select: { pharmacyId: true } });
    if (!sub) return reply.status(404).send({ success: false, error: "Subscription not found" });
    const data = await service.getUsageStats(sub.pharmacyId);
    return reply.send({ success: true, data });
  });

  // ── Get Audit Log ───────────────────────────────────────────────────────────

  app.get("/:id/audit", { preHandler: adminAuth }, async (req, reply) => {
    const { id } = getSubscriptionParamsSchema.parse(req.params);
    const data = await service.getAuditLog(id);
    return reply.send({ success: true, data });
  });
};

export default subscriptionsRoutes;
