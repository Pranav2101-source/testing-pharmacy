import type { FastifyPluginAsync } from "fastify";
import { authenticate, requireManager } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { CashClosureService } from "./cash-closure.service.js";
import {
  createCashClosureSchema,
  updateCashClosureSchema,
  closeCashClosureSchema,
  listCashClosureQuerySchema,
} from "./cash-closure.schema.js";

const cashClosureRoutes: FastifyPluginAsync = async (app) => {
  const service    = new CashClosureService(app);
  const auth       = [authenticate, resolvePharmacy];
  const managerUp  = [authenticate, requireManager, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listCashClosureQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, ...result });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const closure = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: closure });
  });

  // POST / — initialise a closure for a date (auto-pulls sales totals from invoices)
  app.post("/", { preHandler: managerUp }, async (req, reply) => {
    const data    = createCashClosureSchema.parse(req.body);
    const closure = await service.initForDate(req.pharmacyId, req.user.sub, data);
    return reply.status(201).send({ success: true, data: closure });
  });

  app.patch("/:id", { preHandler: managerUp }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const data    = updateCashClosureSchema.parse(req.body);
    const closure = await service.update(id, req.pharmacyId, data);
    return reply.send({ success: true, data: closure });
  });

  // POST /:id/close — finalise and lock the closure
  app.post("/:id/close", { preHandler: managerUp }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const data    = closeCashClosureSchema.parse(req.body);
    const closure = await service.close(id, req.pharmacyId, data);
    return reply.send({ success: true, data: closure });
  });

  // POST /:id/dispute — mark a closed closure as disputed for re-investigation
  app.post("/:id/dispute", { preHandler: managerUp }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const closure = await service.dispute(id, req.pharmacyId);
    return reply.send({ success: true, data: closure });
  });
};

export default cashClosureRoutes;
