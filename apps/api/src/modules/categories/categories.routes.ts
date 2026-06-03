import type { FastifyPluginAsync } from "fastify";
import { CategoriesService } from "./categories.service.js";
import { createCategorySchema, updateCategorySchema } from "./categories.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const categoriesRoutes: FastifyPluginAsync = async (app) => {
  const service   = new CategoriesService(app);
  const auth      = [authenticate, resolvePharmacy];
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (_req, reply) => {
    const items = await service.listAll();
    return reply.send({ success: true, data: items });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cat = await service.getById(id);
    return reply.send({ success: true, data: cat });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input = createCategorySchema.parse(req.body);
    const cat = await service.create(input);
    return reply.status(201).send({ success: true, data: cat });
  });

  app.patch("/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateCategorySchema.parse(req.body);
    const cat    = await service.update(id, input);
    return reply.send({ success: true, data: cat });
  });
};

export default categoriesRoutes;
