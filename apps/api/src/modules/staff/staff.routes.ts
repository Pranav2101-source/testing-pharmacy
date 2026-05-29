import type { FastifyPluginAsync } from "fastify";
import { StaffService } from "./staff.service.js";
import { createStaffSchema, updateStaffSchema } from "./staff.schema.js";
import { requireOwner } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const staffRoutes: FastifyPluginAsync = async (app) => {
  const service = new StaffService(app);
  const preHandler = [requireOwner, resolveTenant];

  app.post("/", { preHandler }, async (req, reply) => {
    const input = createStaffSchema.parse(req.body);
    const staff = await service.create(req.tenantId, input);
    return reply.status(201).send({ success: true, data: staff });
  });

  app.get("/", { preHandler }, async (req, reply) => {
    const staff = await service.list(req.tenantId);
    return reply.send({ success: true, data: staff });
  });

  app.patch("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = updateStaffSchema.parse(req.body);
    const staff = await service.update(id, req.tenantId, input);
    return reply.send({ success: true, data: staff });
  });

  app.delete("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deactivate(id, req.tenantId);
    return reply.send({ success: true, message: "Staff deactivated" });
  });
};

export default staffRoutes;
