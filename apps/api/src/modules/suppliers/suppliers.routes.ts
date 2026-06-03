import type { FastifyPluginAsync } from "fastify";
import { SuppliersService } from "./suppliers.service.js";
import { createSupplierSchema, updateSupplierSchema, listSuppliersQuerySchema, createPurchaseOrderSchema } from "./suppliers.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const suppliersRoutes: FastifyPluginAsync = async (app) => {
  const service    = new SuppliersService(app);
  const auth       = [authenticate, resolvePharmacy];
  const ownerOnly  = [authenticate, requireOwner, resolvePharmacy];

  // Dropdown list (no paging)
  app.get("/all", { preHandler: auth }, async (req, reply) => {
    const items = await service.listAll(req.pharmacyId);
    return reply.send({ success: true, data: items });
  });

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listSuppliersQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input    = createSupplierSchema.parse(req.body);
    const supplier = await service.createSupplier(req.pharmacyId, input);
    return reply.status(201).send({ success: true, data: supplier });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const supplier = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: supplier });
  });

  app.patch("/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input    = updateSupplierSchema.parse(req.body);
    const supplier = await service.updateSupplier(id, req.pharmacyId, input);
    return reply.send({ success: true, data: supplier });
  });

  app.get("/:id/history", { preHandler: auth }, async (req, reply) => {
    const { id }                          = req.params as { id: string };
    const { page = "1", limit = "20" }    = req.query as Record<string, string>;
    const history = await service.getPurchaseHistory(id, req.pharmacyId, Number(page), Number(limit));
    return reply.send({ success: true, data: history });
  });

  // GET /:id/performance — vendor performance metrics (#23)
  app.get("/:id/performance", { preHandler: auth }, async (req, reply) => {
    const { id }          = req.params as { id: string };
    const { from, to }    = req.query as Record<string, string>;
    const result          = await service.getPerformance(id, req.pharmacyId, from, to);
    return reply.send({ success: true, data: result });
  });

  // ── Backward-compat ───────────────────────────────────────────────────────
  app.get("/purchase-orders", { preHandler: auth }, async (req, reply) => {
    const { page = "1", limit = "20", status } = req.query as Record<string, string>;
    const result = await service.listPurchaseOrders(req.pharmacyId, Number(page), Number(limit), status);
    return reply.send({ success: true, data: result });
  });

  app.post("/purchase-orders", { preHandler: auth }, async (req, reply) => {
    const input = createPurchaseOrderSchema.parse(req.body);
    const order = await service.receivePurchaseOrder(req.pharmacyId, input);
    return reply.status(201).send({ success: true, data: order });
  });
};

export default suppliersRoutes;
