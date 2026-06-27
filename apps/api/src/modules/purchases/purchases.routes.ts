import type { FastifyPluginAsync } from "fastify";
import { PurchasesService } from "./purchases.service.js";
import {
  createPOSchema, updatePOSchema, listPOQuerySchema, approvePOSchema, sharePOSchema,
  createGRNSchema, updateGRNSchema, listGRNQuerySchema, autoSuggestQuerySchema,
  fromReorderSchema,
} from "./purchases.schema.js";
import { parseGRNCSV } from "./purchases.import.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const purchasesRoutes: FastifyPluginAsync = async (app) => {
  const service    = new PurchasesService(app);
  const auth       = [authenticate, resolvePharmacy];
  const ownerOnly  = [authenticate, requireOwner, resolvePharmacy];

  // ── Purchase Orders ─────────────────────────────────────────────────────────

  app.get("/orders", { preHandler: auth }, async (req, reply) => {
    const query  = listPOQuerySchema.parse(req.query);
    const result = await service.listPOs(req.pharmacyId, query);
    reply.header("Cache-Control", "private, max-age=30, must-revalidate");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: result });
  });

  // Both OWNER and PHARMACIST can create POs; PHARMACIST-created POs get PENDING_APPROVAL
  app.post("/orders", { preHandler: auth }, async (req, reply) => {
    const input = createPOSchema.parse(req.body);
    const po    = await service.createPO(req.pharmacyId, req.user.sub, req.user.role, input);
    return reply.status(201).send({ success: true, data: po });
  });

  // POST /orders/from-reorder — bulk reorder suggestions → draft PO
  app.post("/orders/from-reorder", { preHandler: auth }, async (req, reply) => {
    const input = fromReorderSchema.parse(req.body);
    const po    = await service.createPOFromReorder(req.pharmacyId, req.user.sub, req.user.role, input);
    return reply.status(201).send({ success: true, data: po });
  });

  app.get("/orders/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const po     = await service.getPOById(id, req.pharmacyId);
    return reply.send({ success: true, data: po });
  });

  app.patch("/orders/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updatePOSchema.parse(req.body);
    const po     = await service.updatePO(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: po });
  });

  // PATCH /orders/:id/approve — OWNER approves or rejects PENDING_APPROVAL POs (#19)
  app.patch("/orders/:id/approve", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = approvePOSchema.parse(req.body);
    const po     = await service.approvePO(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: po });
  });

  // PATCH /orders/:id/send — DRAFT → PENDING (only allowed if approved or not required)
  app.patch("/orders/:id/send", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const po     = await service.sendPO(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, data: po });
  });

  // POST /orders/:id/share — send PO via WhatsApp or Email (#26)
  app.post("/orders/:id/share", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = sharePOSchema.parse(req.body);
    const result = await service.sharePO(id, req.pharmacyId, input);
    return reply.send({ success: true, data: result });
  });

  // DELETE /orders/:id — cancel
  app.delete("/orders/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const po     = await service.cancelPO(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, data: po });
  });

  // ── GRN (Gate Inward) ────────────────────────────────────────────────────────

  app.get("/grn", { preHandler: auth }, async (req, reply) => {
    const query  = listGRNQuerySchema.parse(req.query);
    const result = await service.listGRNs(req.pharmacyId, query);
    reply.header("Cache-Control", "private, max-age=30, must-revalidate");
    reply.header("Vary", "Authorization");
    return reply.send({ success: true, data: result });
  });

  app.post("/grn", { preHandler: ownerOnly }, async (req, reply) => {
    const input = createGRNSchema.parse(req.body);
    const grn   = await service.createGRN(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: grn });
  });

  app.get("/grn/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const grn    = await service.getGRNById(id, req.pharmacyId);
    return reply.send({ success: true, data: grn });
  });

  // PATCH /grn/:id — edit a DRAFT GRN (items, invoice number, notes)
  app.patch("/grn/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateGRNSchema.parse(req.body);
    const grn    = await service.updateGRN(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: grn });
  });

  // PATCH /grn/:id/confirm — DRAFT → CONFIRMED + stock update + set paymentDueDate
  app.patch("/grn/:id/confirm", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const grn    = await service.confirmGRN(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, data: grn });
  });

  // DELETE /grn/:id — cancel DRAFT GRN
  app.delete("/grn/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const grn    = await service.cancelGRN(id, req.pharmacyId, req.user.sub);
    return reply.send({ success: true, data: grn });
  });

  // ── Auto Purchase Suggestions (#3) ──────────────────────────────────────────

  app.get("/suggestions", { preHandler: auth }, async (req, reply) => {
    const query  = autoSuggestQuerySchema.parse(req.query);
    const result = await service.getAutoSuggestions(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  // ── Bulk CSV Import (#29) ─────────────────────────────────────────────────
  // POST /purchases/grn/import  multipart/form-data: { supplierId, file (csv) }
  // Creates a DRAFT GRN from CSV rows. medicineName is matched against the
  // medicines catalog; unmatched names are returned as errors.

  app.post("/grn/import", { preHandler: ownerOnly }, async (req, reply) => {
    let data;
    try {
      data = await req.file();
    } catch {
      return reply.status(400).send({ success: false, error: "Invalid multipart request" });
    }
    if (!data) return reply.status(400).send({ success: false, error: "No file uploaded" });

    const { supplierId, allowNearExpiry } = req.query as { supplierId?: string; allowNearExpiry?: string };
    if (!supplierId) return reply.status(400).send({ success: false, error: "supplierId query param required" });

    let csvText: string;
    try {
      csvText = (await data.toBuffer()).toString("utf-8");
    } catch {
      return reply.status(413).send({ success: false, error: "File too large or unreadable" });
    }
    const rows   = parseGRNCSV(csvText);
    const result = await service.importGRNFromCSV(req.pharmacyId, req.user.sub, supplierId, rows, allowNearExpiry === "true");
    return reply.status(201).send({ success: true, data: result });
  });
};

export default purchasesRoutes;
