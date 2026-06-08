import type { FastifyPluginAsync } from "fastify";
import { BrandsService } from "./brands.service.js";
import { createBrandSchema, updateBrandSchema, listBrandsQuerySchema } from "./brands.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const brandsRoutes: FastifyPluginAsync = async (app) => {
  const service    = new BrandsService(app);
  const preHandler = [authenticate, resolvePharmacy];
  const ownerOnly  = [authenticate, requireOwner, resolvePharmacy];

  // List all brands (for comboboxes) — no paging
  app.get("/all", { preHandler }, async (_req, reply) => {
    const items = await service.listAll();
    // Brands are global master data — rarely change, safe for long public cache.
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=300");
    return reply.send({ success: true, data: items });
  });

  // Paginated list
  app.get("/", { preHandler }, async (req, reply) => {
    const query = listBrandsQuerySchema.parse(req.query);
    const result = await service.list(query);
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=300");
    return reply.send({ success: true, data: result });
  });

  app.get("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const brand = await service.getById(id);
    return reply.send({ success: true, data: brand });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input = createBrandSchema.parse(req.body);
    const brand = await service.create(input);
    return reply.status(201).send({ success: true, data: brand });
  });

  app.patch("/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateBrandSchema.parse(req.body);
    const brand  = await service.update(id, input);
    return reply.send({ success: true, data: brand });
  });
};

export default brandsRoutes;
