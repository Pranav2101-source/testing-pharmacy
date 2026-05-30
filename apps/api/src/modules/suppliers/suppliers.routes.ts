import type { FastifyPluginAsync } from "fastify";
import { SuppliersService } from "./suppliers.service.js";
import { createSupplierSchema, createPurchaseOrderSchema } from "./suppliers.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const suppliersRoutes: FastifyPluginAsync = async (app) => {
  const service = new SuppliersService(app);
  const preHandler = [authenticate, resolveTenant];
  const ownerOnly = [requireOwner, resolveTenant];

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input = createSupplierSchema.parse(req.body);
    const supplier = await service.createSupplier(req.tenantId, input);
    return reply.status(201).send({ success: true, data: supplier });
  });

  app.get("/", { preHandler }, async (req, reply) => {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const result = await service.list(req.tenantId, Number(page), Number(limit));
    return reply.send({ success: true, data: result });
  });

  app.get("/purchase-orders", { preHandler }, async (req, reply) => {
    const { page = "1", limit = "20", status } = req.query as Record<string, string>;
    const result = await service.listPurchaseOrders(req.tenantId, Number(page), Number(limit), status);
    return reply.send({ success: true, data: result });
  });

  app.post("/purchase-orders", { preHandler }, async (req, reply) => {
    const input = createPurchaseOrderSchema.parse(req.body);
    const order = await service.receivePurchaseOrder(req.tenantId, input);
    return reply.status(201).send({ success: true, data: order });
  });
};

export default suppliersRoutes;
