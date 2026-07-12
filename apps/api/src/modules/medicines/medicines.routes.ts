import type { FastifyPluginAsync } from "fastify";
import { MedicinesService } from "./medicines.service.js";
import {
  createMedicineSchema,
  updateMedicineSchema,
  listMedicinesQuerySchema,
  upsertOverrideSchema,
  setBarcodeSchema,
  setClassificationSchema,
} from "./medicines.schema.js";
import { authenticate, requireOwner, requireManager, requireRole } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const medicinesRoutes: FastifyPluginAsync = async (app) => {
  const service = new MedicinesService(app);
  const auth    = [authenticate];
  // The medicine catalog is GLOBAL (shared across every pharmacy). Pharmacy
  // owners may ADD new medicines (additive — required for day-to-day GRN entry
  // of new SKUs), but mutating or deleting an existing entry changes data that
  // every other pharmacy bills against (name, gstRate, schedule), so those
  // operations are restricted to the platform team.
  const owner   = [authenticate, requireOwner];
  // Barcode mapping is safe day-to-day data entry (a barcode is a universal
  // product code, unlike name/gstRate/schedule), so owners AND managers may do it.
  const managerPlus   = [authenticate, requireManager];
  const platformAdmin = [authenticate, requireRole("PLATFORM_ADMIN")];
  const scoped       = [authenticate, resolvePharmacy];
  const ownerScoped  = [authenticate, resolvePharmacy, requireOwner];

  // ── Fast fuzzy search via Meilisearch (used by billing POS) ─────────────
  app.get("/search", { preHandler: auth }, async (req, reply) => {
    const { q = "", limit = "10" } = req.query as Record<string, string>;
    const hits = await service.search(q, Math.min(50, Number(limit)));
    // Medicine catalog is global — same for every user. A short public cache
    // still dedupes bursts of identical searches, but is kept brief so an
    // owner's category/packaging edit propagates to other tabs/devices quickly.
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=30");
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

  // ── Assign / clear a medicine's barcode (owner + manager) ───────────────
  // Narrow mutation of the global catalog: only the barcode field. Guarded
  // against collisions so one barcode never maps to two medicines.
  app.patch("/:id/barcode", { preHandler: managerPlus }, async (req, reply) => {
    const { id }      = req.params as { id: string };
    const { barcode } = setBarcodeSchema.parse(req.body);
    const medicine    = await service.setBarcode(id, barcode);
    return reply.send({ success: true, data: medicine });
  });

  // ── Set a medicine's category / packaging (owner + manager) ─────────────
  // Narrow mutation of the global catalog: only the category and/or unit
  // fields — universal product facts, same rationale as barcode. Lets staff
  // enrich classification from inventory / add-stock / POS over time.
  app.patch("/:id/classification", { preHandler: managerPlus }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const input   = setClassificationSchema.parse(req.body);
    const medicine = await service.setClassification(id, input);
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
        const row     = body.rows[i] as any;
        const prefix  = `Row ${i + 1} (${row?.name ?? "?"})`;
        for (const e of result.error.errors) {
          parseErrors.push(`${prefix}: ${e.message}`);
        }
      }
    }

    const outcome = await service.bulkCreate(valid);
    return reply.send({
      success: true,
      data: { ...outcome, parseErrors },
    });
  });

  // ── Bulk re-index all medicines to Meilisearch (run once after seed) ────
  app.post("/reindex", { preHandler: platformAdmin }, async (_req, reply) => {
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

  // ── Update (platform admin only — mutates a record shared by all pharmacies) ──
  app.patch("/:id", { preHandler: platformAdmin }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const input    = updateMedicineSchema.parse(req.body);
    const medicine = await service.update(id, input);
    return reply.send({ success: true, data: medicine });
  });

  // ── Deactivate (soft delete, platform admin only — hides it for ALL pharmacies) ──
  app.delete("/:id", { preHandler: platformAdmin }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const medicine = await service.deactivate(id);
    return reply.send({ success: true, data: medicine });
  });

  // ── Reactivate (platform admin only) ─────────────────────────────────────
  app.patch("/:id/activate", { preHandler: platformAdmin }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const medicine = await service.reactivate(id);
    return reply.send({ success: true, data: medicine });
  });

  // ── Per-pharmacy overrides (GST / standing discount) ─────────────────────
  // The catalog is global; these let an owner adjust values for THEIR pharmacy
  // only. Registered before /:id — Fastify matches static segments first.

  app.get("/overrides", { preHandler: scoped }, async (req, reply) => {
    const data = await service.listOverrides(req.pharmacyId);
    return reply.send({ success: true, data });
  });

  app.put("/:id/override", { preHandler: ownerScoped }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = upsertOverrideSchema.parse(req.body);
    const data   = await service.upsertOverride(req.pharmacyId, id, input);
    return reply.send({ success: true, data });
  });

  app.delete("/:id/override", { preHandler: ownerScoped }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deleteOverride(req.pharmacyId, id);
    return reply.send({ success: true, data: null });
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
