import type { FastifyPluginAsync } from "fastify";
import { InventoryService } from "./inventory.service.js";
import { addStockSchema, adjustStockSchema, reserveStockSchema } from "./inventory.schema.js";
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

  // PATCH /inventory/:id/adjust — atomic stock correction with audit trail
  app.patch("/:id/adjust", { preHandler }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const input   = adjustStockSchema.parse(req.body);
    const updated = await service.adjustStock(id, req.tenantId, req.user.sub, input);
    return reply.send({ success: true, data: updated });
  });

  // POST /inventory/reserve — create/update reservations for a billing session
  app.post("/reserve", { preHandler }, async (req, reply) => {
    const input = reserveStockSchema.parse(req.body);
    try {
      const result = await service.upsertReservations(req.tenantId, input);
      return reply.send({ success: true, data: result });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; conflicts?: unknown };
      if (e.statusCode === 409) {
        return reply.status(409).send({ success: false, error: e.message, conflicts: e.conflicts });
      }
      throw err;
    }
  });

  // DELETE /inventory/reserve/:sessionId — release reservations for a billing session
  app.delete("/reserve/:sessionId", { preHandler }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    await service.releaseReservations(req.tenantId, sessionId);
    return reply.status(204).send();
  });
};

export default inventoryRoutes;
