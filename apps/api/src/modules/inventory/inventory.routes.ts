import type { FastifyPluginAsync } from "fastify";
import { InventoryService } from "./inventory.service.js";
import { AppError } from "../../lib/AppError.js";
import {
  addStockSchema, adjustStockSchema, reserveStockSchema,
  updateBatchStatusSchema, listInventoryQuerySchema, listLedgerQuerySchema,
  batchRecallSchema, listBatchRecallQuerySchema,
} from "./inventory.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const service    = new InventoryService(app);
  const auth       = [authenticate, resolvePharmacy];
  const ownerOnly  = [authenticate, requireOwner, resolvePharmacy];

  // ── Batch CRUD ─────────────────────────────────────────────────────────────

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input = addStockSchema.parse(req.body);
    const item  = await service.addStock(req.pharmacyId, input);
    return reply.status(201).send({ success: true, data: item });
  });

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listInventoryQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    // Stock changes on every sale — 30-second cache prevents redundant hits when
    // staff open inventory from multiple tabs but keeps data practically current.
    reply.header("Cache-Control", "private, max-age=30, must-revalidate");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: result });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item   = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: item });
  });

  app.patch("/:id/adjust", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = adjustStockSchema.parse(req.body);
    const updated = await service.adjustStock(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: updated });
  });

  // Batch status lifecycle: ACTIVE ↔ QUARANTINE | DAMAGED | EXPIRED
  app.patch("/:id/status", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateBatchStatusSchema.parse(req.body);
    const updated = await service.updateBatchStatus(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: updated });
  });

  // ── Stock Ledger ───────────────────────────────────────────────────────────

  app.get("/ledger", { preHandler: auth }, async (req, reply) => {
    const query  = listLedgerQuerySchema.parse(req.query);
    const result = await service.getLedger(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  // ── Alerts ─────────────────────────────────────────────────────────────────

  app.get("/alerts/expiry", { preHandler: auth }, async (req, reply) => {
    const items = await service.getExpiryAlerts(req.pharmacyId);
    // Expiry status changes daily at most — a 10-minute cache reduces redundant
    // DB queries when staff open the alerts panel multiple times in a shift.
    reply.header("Cache-Control", "private, max-age=600");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: items });
  });

  app.get("/alerts/low-stock", { preHandler: auth }, async (req, reply) => {
    const items = await service.getLowStockAlerts(req.pharmacyId);
    // Low-stock levels change on purchase receipt or sale — 5-minute cache
    // balances freshness with DB load reduction during peak dispensing hours.
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: items });
  });

  // ── FEFO (used by billing POS) ─────────────────────────────────────────────

  app.get("/fefo/:medicineId", { preHandler: auth }, async (req, reply) => {
    const { medicineId } = req.params as { medicineId: string };
    const qty = Number((req.query as any).quantity ?? 1);
    const batch = await service.getFEFOBatch(medicineId, req.pharmacyId, qty);
    return reply.send({ success: true, data: batch });
  });

  // ── Stock Reservation ──────────────────────────────────────────────────────

  app.post("/reserve", { preHandler: auth }, async (req, reply) => {
    const input = reserveStockSchema.parse(req.body);
    try {
      const result = await service.upsertReservations(req.pharmacyId, input);
      return reply.send({ success: true, data: result });
    } catch (err: unknown) {
      if (err instanceof AppError && err.statusCode === 409) {
        return reply.status(409).send({ success: false, error: err.message, ...(err.data ?? {}) });
      }
      throw err;
    }
  });

  app.delete("/reserve/:sessionId", { preHandler: auth }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    await service.releaseReservations(req.pharmacyId, sessionId);
    return reply.status(204).send();
  });

  // ── Shelf / Location assignment ────────────────────────────────────────────

  app.patch("/:id/location", { preHandler: auth }, async (req, reply) => {
    const { id }     = req.params as { id: string };
    const { shelfId, location } = req.body as { shelfId?: string | null; location?: string | null };
    const item = await service.getById(id, req.pharmacyId);
    await service.updateLocation(id, req.pharmacyId, { shelfId, location });
    return reply.send({ success: true, data: { id } });
  });

  // ── Batch Recall ───────────────────────────────────────────────────────────

  app.post("/batch-recall", { preHandler: ownerOnly }, async (req, reply) => {
    const input  = batchRecallSchema.parse(req.body);
    const result = await service.batchRecall(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: result });
  });

  app.get("/batch-recall", { preHandler: auth }, async (req, reply) => {
    const query  = listBatchRecallQuerySchema.parse(req.query);
    const result = await service.listRecalledBatches(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });
};

export default inventoryRoutes;
