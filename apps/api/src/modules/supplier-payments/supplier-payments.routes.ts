import type { FastifyPluginAsync } from "fastify";
import { SupplierPaymentsService } from "./supplier-payments.service.js";
import { createPaymentSchema, listPaymentQuerySchema } from "./supplier-payments.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const supplierPaymentsRoutes: FastifyPluginAsync = async (app) => {
  const service    = new SupplierPaymentsService(app);
  const auth       = [authenticate, resolvePharmacy];
  const ownerOnly  = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listPaymentQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    reply.header("Cache-Control", "private, max-age=30, must-revalidate");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: result });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input   = createPaymentSchema.parse(req.body);
    const payment = await service.create(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: payment });
  });

  // Payables across all suppliers. Static segment, registered before /:id.
  app.get("/outstanding", { preHandler: auth }, async (req, reply) => {
    const result = await service.listOutstanding(req.pharmacyId);
    reply.header("Cache-Control", "private, max-age=30, must-revalidate");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: result });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const payment = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: payment });
  });

  // GET /supplier-payments/balance/:supplierId — outstanding dues + overdue GRNs
  app.get("/balance/:supplierId", { preHandler: auth }, async (req, reply) => {
    const { supplierId } = req.params as { supplierId: string };
    const balance        = await service.getSupplierBalance(supplierId, req.pharmacyId);
    return reply.send({ success: true, data: balance });
  });
};

export default supplierPaymentsRoutes;
