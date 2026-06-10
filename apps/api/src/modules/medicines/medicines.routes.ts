import type { FastifyPluginAsync } from "fastify";
import { MedicinesService } from "./medicines.service.js";
import {
  createMedicineSchema,
  updateMedicineSchema,
  listMedicinesQuerySchema,
} from "./medicines.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";

const medicinesRoutes: FastifyPluginAsync = async (app) => {
  const service = new MedicinesService(app);
  const auth    = [authenticate];
  const owner   = [authenticate, requireOwner];

  // ── Fast fuzzy search via Meilisearch (used by billing POS) ─────────────
  app.get("/search", { preHandler: auth }, async (req, reply) => {
    const { q = "", limit = "10" } = req.query as Record<string, string>;
    const hits = await service.search(q, Math.min(50, Number(limit)));
    // Medicine catalog is global — same for every user. Short public cache lets
    // CDN/reverse-proxy deduplicate identical search queries from multiple tabs.
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
    return reply.send({ success: true, data: hits });
  });

  // ── Barcode lookup (USB scanner / QR scan) ──────────────────────────────
  app.get("/barcode/:code", { preHandler: auth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const medicine = await service.findByBarcode(code);
    if (!medicine) return reply.status(404).send({ success: false, error: "No medicine found for this barcode" });
    // Barcode→medicine mapping is immutable once a product is registered.
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send({ success: true, data: medicine });
  });

  // ── Bulk create from CSV upload (owner only) ────────────────────────────
  app.post("/bulk", { preHandler: owner }, async (req, reply) => {
    const body = req.body as { rows: unknown[] };
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      return reply.status(400).send({ success: false, error: "rows array is required" });
    }
    if (body.rows.length > 5000) {
      return reply.status(400).send({ success: false, error: "Maximum 5000 rows per upload" });
    }

    const valid: ReturnType<typeof createMedicineSchema.parse>[] = [];
    const parseErrors: string[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const result = createMedicineSchema.safeParse(body.rows[i]);
      if (result.success) {
        valid.push(result.data);
      } else {
        const row = body.rows[i] as any;
        parseErrors.push(`Row ${i + 1} (${row?.name ?? "?"}): ${result.error.errors[0]?.message}`);
      }
    }

    const outcome = await service.bulkCreate(valid);
    return reply.send({
      success: true,
      data: { ...outcome, parseErrors },
    });
  });

  // ── Bulk re-index all medicines to Meilisearch (run once after seed) ────
  app.post("/reindex", { preHandler: owner }, async (_req, reply) => {
    const result = await service.reindex();
    return reply.send({ success: true, data: result });
  });

  // ── List with filters + pagination ───────────────────────────────────────
  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listMedicinesQuerySchema.parse(req.query);
    const result = await service.list(query);
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
    return reply.send({ success: true, data: result });
  });

  // ── Get by ID ────────────────────────────────────────────────────────────
  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const medicine = await service.getById(id);
    return reply.send({ success: true, data: medicine });
  });

  // ── Create (owner only) ──────────────────────────────────────────────────
  app.post("/", { preHandler: owner }, async (req, reply) => {
    const input    = createMedicineSchema.parse(req.body);
    const medicine = await service.create(input);
    return reply.status(201).send({ success: true, data: medicine });
  });

  // ── Update (owner only) ──────────────────────────────────────────────────
  app.patch("/:id", { preHandler: owner }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const input    = updateMedicineSchema.parse(req.body);
    const medicine = await service.update(id, input);
    return reply.send({ success: true, data: medicine });
  });

  // ── Deactivate (soft delete, owner only) ────────────────────────────────
  app.delete("/:id", { preHandler: owner }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const medicine = await service.deactivate(id);
    return reply.send({ success: true, data: medicine });
  });

  // ── Reactivate (owner only) ──────────────────────────────────────────────
  app.patch("/:id/activate", { preHandler: owner }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const medicine = await service.reactivate(id);
    return reply.send({ success: true, data: medicine });
  });

  // ── Generic substitution alternatives (pharmacy-specific stock data) ─────
  app.get("/:id/alternatives", { preHandler: auth }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const user     = req.user as { pharmacyId: string };
    const data     = await service.getAlternatives(id, user.pharmacyId);
    return reply.send({ success: true, data });
  });
};

export default medicinesRoutes;
