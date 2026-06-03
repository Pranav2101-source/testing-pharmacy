import type { FastifyPluginAsync } from "fastify"
import { authenticate, requireOwner } from "../../middleware/auth.js"
import { resolvePharmacy } from "../../middleware/tenant.js"
import { StockAuditService } from "./stock-audit.service.js"
import {
  approveSessionSchema,
  completeSessionSchema,
  createSessionSchema,
  listSessionsQuerySchema,
  updateItemSchema,
} from "./stock-audit.schema.js"

const stockAuditRoutes: FastifyPluginAsync = async (app) => {
  const auth = [authenticate, resolvePharmacy]
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy]
  const svc = new StockAuditService(app)

  app.post("/", { preHandler: auth }, async (req, reply) => {
    const body = createSessionSchema.parse(req.body)
    const session = await svc.createSession(req.pharmacyId, req.user.sub, body)
    return reply.status(201).send({ success: true, data: session })
  })

  app.get("/", { preHandler: auth }, async (req, reply) => {
    const query = listSessionsQuerySchema.parse(req.query)
    const result = await svc.listSessions(req.pharmacyId, query)
    return reply.send({ success: true, data: result })
  })

  app.get("/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await svc.getSession(id, req.pharmacyId)
    return reply.send({ success: true, data: session })
  })

  app.patch("/:id/start", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = await svc.startSession(id, req.pharmacyId)
    return reply.send({ success: true, data: session })
  })

  app.patch("/:id/items/:itemId", { preHandler: auth }, async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string }
    const body = updateItemSchema.parse(req.body)
    const item = await svc.updateItem(id, itemId, req.pharmacyId, body)
    return reply.send({ success: true, data: item })
  })

  // GET /:id/variance-summary — dry-run preview of adjustments that approve would apply
  app.get("/:id/variance-summary", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const result = await svc.getVarianceSummary(id, req.pharmacyId)
    return reply.send({ success: true, data: result })
  })

  app.post("/:id/complete", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = completeSessionSchema.parse(req.body ?? {})
    const session = await svc.completeSession(id, req.pharmacyId, req.user.sub, body)
    return reply.send({ success: true, data: session })
  })

  app.post("/:id/approve", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = approveSessionSchema.parse(req.body ?? {})
    const session = await svc.approveSession(id, req.pharmacyId, req.user.sub, body)
    return reply.send({ success: true, data: session })
  })

  app.delete("/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await svc.cancelSession(id, req.pharmacyId, req.user.sub)
    return reply.status(204).send()
  })
}

export default stockAuditRoutes
