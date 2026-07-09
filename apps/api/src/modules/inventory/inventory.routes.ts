import type { FastifyPluginAsync } from "fastify";
import { InventoryService } from "./inventory.service.js";
import { AppError } from "../../lib/AppError.js";
import {
  addStockSchema, reserveStockSchema,
  listInventoryQuerySchema, listLedgerQuerySchema,
  batchRecallSchema, listBatchRecallQuerySchema,
  patchInventorySchema, listAlertsQuerySchema, calibrateStockSchema,
} from "./inventory.schema.js";
import { authenticate, requireOwner, requireManager } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const service    = new InventoryService(app);
  const auth       = [authenticate, resolvePharmacy];
  const ownerOnly  = [authenticate, requireOwner, resolvePharmacy];
  // Adding received stock is a routine operation staff managers perform, and it
  // mirrors the OWNER+MANAGER gate already used for stock adjustments (PATCH /:id).
  const managerPlus = [authenticate, requireManager, resolvePharmacy];

  // ── Batch CRUD ─────────────────────────────────────────────────────────────

  app.post("/", { preHandler: managerPlus }, async (req, reply) => {
    const input  = addStockSchema.parse(req.body);
    // req.user.sub is the authenticated user id (JWT payload uses `sub`, not `id`).
    const result = await service.addStock(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: result.item, meta: { merged: result.merged } });
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

  // ── Unified PATCH /:id ────────────────────────────────────────────────────
  // One endpoint handles adjust / status / location. adjust + status require
  // owner/manager role (checked in-handler); location is open to all staff.
  app.patch("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body   = patchInventorySchema.parse(req.body);

    // Role gate for destructive operations — must be OWNER or MANAGER
    if (body.adjust || body.status !== undefined) {
      const user = await app.prisma.user.findFirst({
        where:  { id: req.user.sub },
        select: { role: true },
      });
      if (!user || !["OWNER", "MANAGER"].includes(user.role)) {
        throw AppError.forbidden("Only owners and managers can adjust stock or change batch status");
      }
    }

    let result: unknown;
    if (body.adjust) {
      result = await service.adjustStock(id, req.pharmacyId, req.user.sub, body.adjust);
    }
    if (body.status !== undefined) {
      result = await service.updateBatchStatus(id, req.pharmacyId, req.user.sub, {
        status: body.status,
        reason: body.statusReason!,
      });
    }
    if (body.shelfId !== undefined || body.location !== undefined) {
      result = await service.updateLocation(id, req.pharmacyId, {
        shelfId:  body.shelfId,
        location: body.location,
      });
    }

    return reply.send({ success: true, data: result });
  });

  // ── Stock Ledger ───────────────────────────────────────────────────────────

  app.get("/ledger", { preHandler: auth }, async (req, reply) => {
    const query  = listLedgerQuerySchema.parse(req.query);
    const result = await service.getLedger(req.pharmacyId, query);
    // Movement history changes on every stock action — 30-second cache matches
    // the list endpoint's TTL to avoid redundant hits on rapid tab switching.
    reply.header("Cache-Control", "private, max-age=30, must-revalidate");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: result });
  });

  // ── Unified alerts ─────────────────────────────────────────────────────────
  // GET /alerts               → { expiry: [...], lowStock: [...] }
  // GET /alerts?type=expiry   → { expiry: [...], lowStock: [] }
  // GET /alerts?type=lowStock → { expiry: [], lowStock: [...] }
  // Cache 5 min — low-stock changes most frequently so we use the shorter TTL.
  app.get("/alerts", { preHandler: auth }, async (req, reply) => {
    const { type } = listAlertsQuerySchema.parse(req.query);
    const data = await service.getAlerts(req.pharmacyId, type);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data });
  });

  // ── Frequent items (Quick Add panel on billing POS) ───────────────────────
  // Top 10 medicines billed in the last 30 days, with current best batch.
  // Cached 5 min — changes slowly enough that stale data is fine here.

  app.get("/frequent", { preHandler: auth }, async (req, reply) => {
    const items = await service.getFrequent(req.pharmacyId);
    reply.header("Cache-Control", "private, max-age=300");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: items });
  });

  // ── FEFO (used by billing POS) ─────────────────────────────────────────────

  app.get("/fefo/:medicineId", { preHandler: auth }, async (req, reply) => {
    const { medicineId } = req.params as { medicineId: string };
    const rawQty = Number((req.query as Record<string, string>)["quantity"]);
    const qty    = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
    const batch  = await service.getFEFOBatch(medicineId, req.pharmacyId, qty);
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

  // ── Smart Stock Calibration ────────────────────────────────────────────────
  // Analyzes 90 days of sales → recomputes minimumStock per medicine.
  // dryRun=true returns the preview without writing, so the UI can show a
  // confirmation screen before the owner commits.
  app.post("/calibrate-stock", { preHandler: ownerOnly }, async (req, reply) => {
    const { dryRun } = calibrateStockSchema.parse(req.body);
    const result = await service.calibrateMinimumStock(req.pharmacyId, dryRun);
    return reply.send({ success: true, data: result });
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
