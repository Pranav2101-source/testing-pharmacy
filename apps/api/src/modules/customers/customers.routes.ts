import type { FastifyPluginAsync } from "fastify";
import { CustomersService } from "./customers.service.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
} from "./customers.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const customersRoutes: FastifyPluginAsync = async (app) => {
  const service = new CustomersService(app);
  const auth    = [authenticate, resolvePharmacy];
  const owner   = [authenticate, requireOwner, resolvePharmacy];

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listCustomersQuerySchema.parse(req.query);
    const result = await service.list(req.pharmacyId, query);
    return reply.send({ success: true, data: result });
  });

  app.post("/", { preHandler: auth }, async (req, reply) => {
    const input    = createCustomerSchema.parse(req.body);
    const customer = await service.create(req.pharmacyId, input);
    return reply.status(201).send({ success: true, data: customer });
  });

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const customer = await service.getById(id, req.pharmacyId);
    return reply.send({ success: true, data: customer });
  });

  app.patch("/:id", { preHandler: auth }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const input    = updateCustomerSchema.parse(req.body);
    const customer = await service.update(id, req.pharmacyId, input);
    return reply.send({ success: true, data: customer });
  });

  app.delete("/:id", { preHandler: owner }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.delete(id, req.pharmacyId);
    return reply.send({ success: true, data: null });
  });

  app.get("/:id/credit", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const credit = await service.getCreditSummary(id, req.pharmacyId);
    return reply.send({ success: true, data: credit });
  });
};

export default customersRoutes;
