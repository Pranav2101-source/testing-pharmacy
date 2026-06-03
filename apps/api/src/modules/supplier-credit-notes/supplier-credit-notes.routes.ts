import type { FastifyPluginAsync } from "fastify";
import { SupplierCreditNotesService } from "./supplier-credit-notes.service.js";
import { createCreditNoteSchema, updateCreditNoteStatusSchema, listCreditNoteQuerySchema } from "./supplier-credit-notes.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const supplierCreditNotesRoutes: FastifyPluginAsync = async (app) => {
  const service   = new SupplierCreditNotesService(app);
  const auth      = [authenticate, resolvePharmacy];
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listCreditNoteQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input = createCreditNoteSchema.parse(req.body);
    const cn    = await service.create(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: cn });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cn     = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: cn });
  });

  // PATCH /:id/status — mark as APPLIED or CANCELLED
  app.patch("/:id/status", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateCreditNoteStatusSchema.parse(req.body);
    const cn     = await service.updateStatus(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: cn });
  });
};

export default supplierCreditNotesRoutes;
