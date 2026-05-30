import type { FastifyPluginAsync } from "fastify";
import { BillingService } from "./billing.service.js";
import {
  createInvoiceSchema,
  cancelInvoiceSchema,
  addPaymentSchema,
  createReturnSchema,
  listInvoicesQuerySchema,
  listReturnsQuerySchema,
} from "./billing.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const billingRoutes: FastifyPluginAsync = async (app) => {
  const service = new BillingService(app);

  const auth  = [authenticate, resolveTenant];
  const owner = [authenticate, requireOwner, resolveTenant];

  // ── Dashboard stats ───────────────────────────────────────────────────
  app.get("/dashboard/stats", { preHandler: auth }, async (req, reply) => {
    const stats = await service.getDashboardStats(req.tenantId);
    return reply.send({ success: true, data: stats });
  });

  // ── FIFO batch selection ──────────────────────────────────────────────
  app.get("/batch-select", { preHandler: auth }, async (req, reply) => {
    const { medicineId, quantity } = req.query as { medicineId: string; quantity: string };
    if (!medicineId) {
      return reply.status(400).send({ success: false, error: "medicineId is required" });
    }
    const qty = Number(quantity ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      return reply.status(400).send({ success: false, error: "quantity must be a positive number" });
    }
    const batch = await service.getFifoBatch(medicineId, req.tenantId, qty);
    return reply.send({ success: true, data: batch });
  });

  // ── Invoices ──────────────────────────────────────────────────────────

  app.post("/", { preHandler: auth }, async (req, reply) => {
    const input   = createInvoiceSchema.parse(req.body);
    const invoice = await service.createInvoice(req.tenantId, req.user.sub, input, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return reply.status(201).send({ success: true, data: invoice });
  });

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listInvoicesQuerySchema.parse(req.query);
    const result = await service.listInvoices(req.tenantId, query);
    return reply.send({ success: true, data: result });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await service.getInvoice(id, req.tenantId);
    return reply.send({ success: true, data: invoice });
  });

  app.patch("/:id/cancel", { preHandler: owner }, async (req, reply) => {
    const { id }     = req.params as { id: string };
    const { reason } = cancelInvoiceSchema.parse(req.body);
    const invoice    = await service.cancelInvoice(id, req.tenantId, req.user.sub, reason, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return reply.send({ success: true, data: invoice });
  });

  // ── Payments ──────────────────────────────────────────────────────────

  app.post("/:id/payments", { preHandler: auth }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const input   = addPaymentSchema.parse(req.body);
    const payment = await service.addPayment(id, req.tenantId, req.user.sub, input, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return reply.status(201).send({ success: true, data: payment });
  });

  // ── Returns ───────────────────────────────────────────────────────────

  // List all returns (with optional filters)
  app.get("/returns", { preHandler: auth }, async (req, reply) => {
    const query  = listReturnsQuerySchema.parse(req.query);
    const result = await service.listReturns(req.tenantId, query);
    return reply.send({ success: true, data: result });
  });

  // Get single return
  app.get("/returns/:returnId", { preHandler: auth }, async (req, reply) => {
    const { returnId } = req.params as { returnId: string };
    const ret = await service.getReturn(returnId, req.tenantId);
    return reply.send({ success: true, data: ret });
  });

  // Create return against a specific invoice
  app.post("/:id/returns", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = createReturnSchema.parse(req.body);
    const ret    = await service.createReturn(id, req.tenantId, req.user.sub, input, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return reply.status(201).send({ success: true, data: ret });
  });

  // Get returns for a specific invoice
  app.get("/:id/returns", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const query  = listReturnsQuerySchema.parse({ ...(req.query as Record<string, unknown>), invoiceId: id });
    const result = await service.listReturns(req.tenantId, query);
    return reply.send({ success: true, data: result });
  });
};

export default billingRoutes;
