import type { FastifyPluginAsync } from "fastify";
import { QuotationsService } from "./quotations.service.js";
import { z } from "zod";
import {
  createQuotationSchema, updateQuotationSchema, listQuotationQuerySchema, compareQuotationsSchema,
} from "./quotations.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const quotationsRoutes: FastifyPluginAsync = async (app) => {
  const service   = new QuotationsService(app);
  const auth      = [authenticate, resolvePharmacy];
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listQuotationQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  app.post("/", { preHandler: ownerOnly }, async (req, reply) => {
    const input     = createQuotationSchema.parse(req.body);
    const quotation = await service.create(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: quotation });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q      = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: q });
  });

  app.patch("/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = updateQuotationSchema.parse(req.body);
    const q      = await service.update(id, req.pharmacyId, req.user.sub, input);
    return reply.send({ success: true, data: q });
  });

  // Status transitions
  app.patch("/:id/send",     { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await service.markSent(id, req.pharmacyId, req.user.sub) });
  });

  app.patch("/:id/receive",  { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await service.markReceived(id, req.pharmacyId, req.user.sub) });
  });

  app.patch("/:id/expire",   { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await service.markExpired(id, req.pharmacyId, req.user.sub) });
  });

  // POST /quotations/compare — side-by-side price comparison
  app.post("/compare", { preHandler: auth }, async (req, reply) => {
    const input  = compareQuotationsSchema.parse(req.body);
    const result = await service.compare(req.pharmacyId, input);
    return reply.send({ success: true, data: result });
  });

  // POST /quotations/:id/convert-to-po — convert a RECEIVED quotation into a DRAFT PO
  const convertToPOBodySchema = z.object({ notes: z.string().max(500).optional() });
  app.post("/:id/convert-to-po", { preHandler: ownerOnly }, async (req, reply) => {
    const { id }    = req.params as { id: string };
    const { notes } = convertToPOBodySchema.parse(req.body ?? {});
    const result    = await service.convertToPO(id, req.pharmacyId, req.user.sub, notes);
    return reply.status(201).send({ success: true, data: result });
  });
};

export default quotationsRoutes;
