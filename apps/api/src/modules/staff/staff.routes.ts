import type { FastifyPluginAsync } from "fastify";
import { StaffService } from "./staff.service.js";
import { createStaffSchema, updateStaffSchema } from "./staff.schema.js";
import { authenticate, requireOwner, requireRole } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const staffRoutes: FastifyPluginAsync = async (app) => {
  const service = new StaffService(app);
  // Owners can do everything; managers can only read the staff list.
  const readHandler  = [authenticate, requireRole("OWNER", "MANAGER"), resolvePharmacy];
  const writeHandler = [authenticate, requireOwner,                    resolvePharmacy];

  app.post("/", { preHandler: writeHandler }, async (req, reply) => {
    const input = createStaffSchema.parse(req.body);
    const staff = await service.create(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: staff });
  });

  app.get("/", { preHandler: readHandler }, async (req, reply) => {
    const staff = await service.list(req.pharmacyId);
    return reply.send({ success: true, data: staff });
  });

  app.patch("/:id", { preHandler: writeHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateStaffSchema.parse(req.body);
    const staff  = await service.update(id, req.pharmacyId, input);
    return reply.send({ success: true, data: staff });
  });

  app.delete("/:id", { preHandler: writeHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deactivate(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, message: "Staff deactivated" });
  });
};

export default staffRoutes;
