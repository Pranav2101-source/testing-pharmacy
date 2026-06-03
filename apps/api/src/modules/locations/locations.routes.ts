import type { FastifyPluginAsync } from "fastify"
import { authenticate, requireOwner } from "../../middleware/auth.js"
import { resolvePharmacy } from "../../middleware/tenant.js"
import { LocationsService } from "./locations.service.js"
import {
  createRackSchema,
  createShelfSchema,
  listRacksQuerySchema,
  updateRackSchema,
  updateShelfSchema,
} from "./locations.schema.js"

const locationsRoutes: FastifyPluginAsync = async (app) => {
  const auth = [authenticate, resolvePharmacy]
  const ownerOnly = [authenticate, requireOwner, resolvePharmacy]
  const svc = new LocationsService(app)

  // ── Racks ──────────────────────────────────────────────────────────────────

  app.post("/racks", { preHandler: ownerOnly }, async (req, reply) => {
    const body = createRackSchema.parse(req.body)
    const rack = await svc.createRack(req.pharmacyId, body)
    return reply.status(201).send({ success: true, data: rack })
  })

  app.get("/racks", { preHandler: auth }, async (req, reply) => {
    const query = listRacksQuerySchema.parse(req.query)
    const result = await svc.listRacks(req.pharmacyId, query)
    return reply.send({ success: true, data: result })
  })

  app.get("/racks/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const rack = await svc.getRack(id, req.pharmacyId)
    return reply.send({ success: true, data: rack })
  })

  app.patch("/racks/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = updateRackSchema.parse(req.body)
    const rack = await svc.updateRack(id, req.pharmacyId, body)
    return reply.send({ success: true, data: rack })
  })

  // ── Shelves ─────────────────────────────────────────────────────────────────

  app.post("/shelves", { preHandler: ownerOnly }, async (req, reply) => {
    const body = createShelfSchema.parse(req.body)
    const shelf = await svc.createShelf(req.pharmacyId, body)
    return reply.status(201).send({ success: true, data: shelf })
  })

  app.get("/shelves", { preHandler: auth }, async (req, reply) => {
    const { dropdown } = req.query as { dropdown?: string }
    if (dropdown === "true") {
      const shelves = await svc.getShelfDropdown(req.pharmacyId)
      return reply.send({ success: true, data: shelves })
    }
    const query = listRacksQuerySchema.parse(req.query)
    const result = await svc.listShelves(req.pharmacyId, query)
    return reply.send({ success: true, data: result })
  })

  app.patch("/shelves/:id", { preHandler: ownerOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = updateShelfSchema.parse(req.body)
    const shelf = await svc.updateShelf(id, req.pharmacyId, body)
    return reply.send({ success: true, data: shelf })
  })
}

export default locationsRoutes
