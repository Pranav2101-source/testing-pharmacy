import type { FastifyPluginAsync } from "fastify";
import { MigrationService } from "./migration.service.js";
import {
  createSessionSchema,
  detectColumnsSchema,
  saveColumnMappingsSchema,
  confirmMedicineMappingsSchema,
  previewInventorySchema,
  commitInventorySchema,
  commitSuppliersSchema,
  commitCustomersSchema,
  commitDoctorsSchema,
} from "./migration.schemas.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const migrationRoutes: FastifyPluginAsync = async (app) => {
  const service   = new MigrationService(app);
  // Migration is owner-only: it touches global catalog and all pharmacy data
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy];

  // Migration CSVs are sent as text in the JSON body and can be large (tens of
  // thousands of rows). The global 1 MB body limit is far too small, so the
  // routes that carry `csvText` get a dedicated higher limit. Beyond this the
  // service's own row-count guard returns a friendly "split the file" message.
  const CSV_BODY_LIMIT = 25 * 1024 * 1024; // 25 MB

  // ── Sessions ──────────────────────────────────────────────────────────────

  app.post("/sessions", { preHandler: ownerOnly }, async (req, reply) => {
    const input   = createSessionSchema.parse(req.body);
    const session = await service.createSession(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: session });
  });

  app.get("/sessions", { preHandler: ownerOnly }, async (req, reply) => {
    const sessions = await service.listSessions(req.pharmacyId);
    return reply.send({ success: true, data: sessions });
  });

  // Prior successful imports (per entity) — powers the "already imported" warning
  app.get("/history", { preHandler: ownerOnly }, async (req, reply) => {
    const history = await service.getImportHistory(req.pharmacyId);
    return reply.send({ success: true, data: history });
  });

  app.get("/sessions/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await service.getSession(id, req.pharmacyId);
    return reply.send({ success: true, data: session });
  });

  // Mark session fully complete (after all steps done)
  app.post("/sessions/:id/complete", { preHandler: ownerOnly }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const session = await service.completeSession(id, req.pharmacyId);
    return reply.send({ success: true, data: session });
  });

  // Rollback all records created by this session
  app.delete("/sessions/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const session = await service.rollbackSession(id, req.pharmacyId);
    return reply.send({ success: true, data: session });
  });

  // ── Column detection ──────────────────────────────────────────────────────

  // Auto-detect column header meanings from a CSV header row
  app.post("/detect-columns", { preHandler: ownerOnly }, async (req, reply) => {
    const input  = detectColumnsSchema.parse(req.body);
    const result = service.detectColumns(input.headers);
    return reply.send({ success: true, data: result });
  });

  // Save confirmed column mappings on the session
  app.patch("/sessions/:id/column-mappings", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = saveColumnMappingsSchema.parse(req.body);
    const session = await service.saveColumnMappings(id, req.pharmacyId, input.mappings as any);
    return reply.send({ success: true, data: session });
  });

  // ── Medicine mapping ──────────────────────────────────────────────────────

  // Suggest catalog matches for all unique medicine names in the CSV
  app.post("/sessions/:id/medicine-suggestions", { preHandler: ownerOnly, bodyLimit: CSV_BODY_LIMIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.getSession(id, req.pharmacyId); // verify session ownership
    const input  = previewInventorySchema.parse(req.body);
    const result = await service.suggestMedicineMappings(req.pharmacyId, input.csvText, input.columnMappings as any);
    return reply.send({ success: true, data: result });
  });

  // Save user-confirmed medicine mappings (csvValue → medicineId or isNew)
  app.post("/sessions/:id/medicine-mappings", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = confirmMedicineMappingsSchema.parse(req.body);
    const result = await service.confirmMedicineMappings(req.pharmacyId, id, req.user.sub, input);
    return reply.send({ success: true, data: result });
  });

  // ── Preview (dry-run — no writes) ─────────────────────────────────────────

  app.post("/sessions/:id/preview/inventory", { preHandler: ownerOnly, bodyLimit: CSV_BODY_LIMIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = previewInventorySchema.parse(req.body);
    const result = await service.previewInventory(req.pharmacyId, input.csvText, input.columnMappings as any);
    return reply.send({ success: true, data: result });
  });

  // ── Commit (write to DB) ──────────────────────────────────────────────────

  app.post("/sessions/:id/commit/inventory", { preHandler: ownerOnly, bodyLimit: CSV_BODY_LIMIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = commitInventorySchema.parse(req.body);
    const result = await service.commitInventory(id, req.pharmacyId, req.user.sub, input.csvText, input.columnMappings as any);
    return reply.send({ success: true, data: result });
  });

  app.post("/sessions/:id/commit/suppliers", { preHandler: ownerOnly, bodyLimit: CSV_BODY_LIMIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = commitSuppliersSchema.parse(req.body);
    const result = await service.commitSuppliers(id, req.pharmacyId, req.user.sub, input.csvText, input.columnMappings as any);
    return reply.send({ success: true, data: result });
  });

  app.post("/sessions/:id/commit/customers", { preHandler: ownerOnly, bodyLimit: CSV_BODY_LIMIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = commitCustomersSchema.parse(req.body);
    const result = await service.commitCustomers(id, req.pharmacyId, req.user.sub, input.csvText, input.columnMappings as any);
    return reply.send({ success: true, data: result });
  });

  app.post("/sessions/:id/commit/doctors", { preHandler: ownerOnly, bodyLimit: CSV_BODY_LIMIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = commitDoctorsSchema.parse(req.body);
    const result = await service.commitDoctors(id, req.pharmacyId, req.user.sub, input.csvText, input.columnMappings as any);
    return reply.send({ success: true, data: result });
  });
};

export default migrationRoutes;
