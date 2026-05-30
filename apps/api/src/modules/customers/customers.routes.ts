import type { FastifyPluginAsync } from "fastify";
import { CustomersService } from "./customers.service.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
} from "./customers.schema.js";
import { authenticate, requireOwner } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const customersRoutes: FastifyPluginAsync = async (app) => {
  const service = new CustomersService(app);
  const auth    = [authenticate, resolveTenant];
  const owner   = [authenticate, requireOwner, resolveTenant];

  // List customers (with search + type filter)
  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query  = listCustomersQuerySchema.parse(req.query);
    const result = await service.list(req.tenantId, query);
    return reply.send({ success: true, data: result });
  });

  // Create customer
  app.post("/", { preHandler: auth }, async (req, reply) => {
    const input    = createCustomerSchema.parse(req.body);
    const customer = await service.create(req.tenantId, input);
    return reply.status(201).send({ success: true, data: customer });
  });

  // Get customer by ID (with recent invoice history)
  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const customer = await service.getById(id, req.tenantId);
    return reply.send({ success: true, data: customer });
  });

  // Update customer
  app.patch("/:id", { preHandler: auth }, async (req, reply) => {
    const { id }   = req.params as { id: string };
    const input    = updateCustomerSchema.parse(req.body);
    const customer = await service.update(id, req.tenantId, input);
    return reply.send({ success: true, data: customer });
  });

  // Delete customer (owner only)
  app.delete("/:id", { preHandler: owner }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.delete(id, req.tenantId);
    return reply.send({ success: true, data: null });
  });

  // Credit summary
  app.get("/:id/credit", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const credit = await service.getCreditSummary(id, req.tenantId);
    return reply.send({ success: true, data: credit });
  });
};

export default customersRoutes;
