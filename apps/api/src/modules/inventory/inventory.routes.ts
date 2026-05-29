import type { FastifyPluginAsync } from "fastify";
import { InventoryService } from "./inventory.service.js";
import { addStockSchema } from "./inventory.schema.js";
import { authenticate } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const service = new InventoryService(app);
  const preHandler = [authenticate, resolveTenant];

  app.post("/", { preHandler }, async (req, reply) => {
    const input = addStockSchema.parse(req.body);
    const item = await service.addStock(req.tenantId, input);
    return reply.status(201).send({ success: true, data: item });
  });

  app.get("/", { preHandler }, async (req, reply) => {
    const result = await service.list(req.tenantId, req.query as Record<string, string>);
    return reply.send({ success: true, data: result });
  });

  app.get("/alerts/expiry", { preHandler }, async (req, reply) => {
    const items = await service.getExpiryAlerts(req.tenantId);
    return reply.send({ success: true, data: items });
  });

  app.get("/alerts/low-stock", { preHandler }, async (req, reply) => {
    const items = await service.getLowStockAlerts(req.tenantId);
    return reply.send({ success: true, data: items });
  });

  app.get("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await service.getById(id, req.tenantId);
    return reply.send({ success: true, data: item });
  });
};

export default inventoryRoutes;
