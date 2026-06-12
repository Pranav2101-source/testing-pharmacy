import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireManager } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { DoctorsService } from "./doctors.service.js";
import {
  createDoctorSchema,
  updateDoctorSchema,
  listDoctorsQuerySchema,
} from "./doctors.schema.js";

const doctorsRoutes: FastifyPluginAsync = async (app) => {
  const service   = new DoctorsService(app);
  const auth      = [authenticate, resolvePharmacy];
  const managerUp = [authenticate, requireManager, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listDoctorsQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, ...result });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doctor = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: doctor });
  });

  app.post("/", { preHandler: managerUp }, async (req, reply) => {
    const data   = createDoctorSchema.parse(req.body);
    const doctor = await service.create(req.pharmacyId, data);
    return reply.status(201).send({ success: true, data: doctor });
  });

  app.patch("/:id", { preHandler: managerUp }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = updateDoctorSchema.parse(req.body);
    const doctor = await service.update(id, req.pharmacyId, data);
    return reply.send({ success: true, data: doctor });
  });

  app.patch("/:id/deactivate", { preHandler: managerUp }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doctor = await service.deactivate(id, req.pharmacyId);
    return reply.send({ success: true, data: doctor });
  });

  app.patch("/:id/reactivate", { preHandler: managerUp }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doctor = await service.reactivate(id, req.pharmacyId);
    return reply.send({ success: true, data: doctor });
  });
};

export default doctorsRoutes;
