import type { FastifyPluginAsync } from "fastify";
import { SupplierReturnsService } from "./supplier-returns.service.js";
import { createSRSchema, listSRQuerySchema } from "./supplier-returns.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const supplierReturnsRoutes: FastifyPluginAsync = async (app) => {
  const service   = new SupplierReturnsService(app);
  const auth      = [authenticate, resolvePharmacy];
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listSRQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input = createSRSchema.parse(req.body);
    const sr    = await service.create(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: sr });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sr     = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: sr });
  });

  // PATCH /supplier-returns/:id/confirm — decrement inventory
  app.patch("/:id/confirm", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sr     = await service.confirm(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, data: sr });
  });

  // DELETE /supplier-returns/:id — cancel DRAFT
  app.delete("/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const sr     = await service.cancel(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, data: sr });
  });
};

export default supplierReturnsRoutes;
