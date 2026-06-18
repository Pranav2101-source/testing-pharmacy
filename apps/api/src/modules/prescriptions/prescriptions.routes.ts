import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { PrescriptionsService } from "./prescriptions.service.js";
import { createPrescriptionSchema, updatePrescriptionSchema, listPrescriptionsQuerySchema } from "./prescriptions.schema.js";

const prescriptionsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolvePharmacy];
  const service    = new PrescriptionsService(app);

  // Create prescription
  app.post("/", { preHandler }, async (req, reply) => {
    const data = createPrescriptionSchema.parse(req.body);
    const rx   = await service.create(req.pharmacyId, data);
    return reply.code(201).send({ success: true, data: rx });
  });

  // List prescriptions (with optional filters)
  app.get("/", { preHandler }, async (req, reply) => {
    const query = listPrescriptionsQuerySchema.parse(req.query);
    const rx    = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, data: rx });
  });

  // Get prescription by id
  app.get("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rx     = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: rx });
  });

  // Update prescription (doctor, patient, dates, items)
  app.patch("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = updatePrescriptionSchema.parse(req.body);
    const rx     = await service.update(id, req.pharmacyId, data);
    return reply.send({ success: true, data: rx });
  });

  // Cancel prescription
  app.delete("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rx     = await service.cancel(id, req.pharmacyId);
    return reply.send({ success: true, data: rx });
  });
};

export default prescriptionsRoutes;
