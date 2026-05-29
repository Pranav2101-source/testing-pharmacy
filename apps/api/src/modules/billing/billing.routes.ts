import type { FastifyPluginAsync } from "fastify";
import { BillingService } from "./billing.service.js";
import { createInvoiceSchema, cancelInvoiceSchema } from "./billing.schema.js";
import { authenticate } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";
import { requireOwner } from "../../middleware/auth.js";

const billingRoutes: FastifyPluginAsync = async (app) => {
  const service = new BillingService(app);
  const preHandler = [authenticate, resolveTenant];

  app.post("/", { preHandler }, async (req, reply) => {
    const input = createInvoiceSchema.parse(req.body);
    const invoice = await service.createInvoice(req.tenantId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: invoice });
  });

  app.get("/", { preHandler }, async (req, reply) => {
    const query = req.query as Record<string, string>;
    const result = await service.listInvoices(req.tenantId, {
      page: Number(query["page"] ?? 1),
      limit: Number(query["limit"] ?? 20),
      search: query["search"],
      from: query["from"],
      to: query["to"],
    });
    return reply.send({ success: true, data: result });
  });

  app.get("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await service.getInvoice(id, req.tenantId);
    return reply.send({ success: true, data: invoice });
  });

  app.patch("/:id/cancel", { preHandler: [requireOwner, resolveTenant] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = cancelInvoiceSchema.parse(req.body);
    const invoice = await service.cancelInvoice(id, req.tenantId, reason);
    return reply.send({ success: true, data: invoice });
  });
};

export default billingRoutes;
