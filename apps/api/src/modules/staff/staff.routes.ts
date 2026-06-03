import type { FastifyPluginAsync } from "fastify";
import { StaffService } from "./staff.service.js";
import { createStaffSchema, updateStaffSchema } from "./staff.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const staffRoutes: FastifyPluginAsync = async (app) => {
  const service = new StaffService(app);
  // authenticate MUST come first — requireOwner reads request.user set by authenticate
  const preHandler = [authenticate, requireOwner, resolvePharmacy];

  app.post("/", { preHandler }, async (req, reply) => {
    const input = createStaffSchema.parse(req.body);
    const staff = await service.create(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: staff });
  });

  app.get("/", { preHandler }, async (req, reply) => {
    const staff = await service.list(req.pharmacyId);
    return reply.send({ success: true, data: staff });
  });

  app.patch("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateStaffSchema.parse(req.body);
    const staff  = await service.update(id, req.pharmacyId, input);
    return reply.send({ success: true, data: staff });
  });

  app.delete("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deactivate(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, message: "Staff deactivated" });
  });
};

export default staffRoutes;
