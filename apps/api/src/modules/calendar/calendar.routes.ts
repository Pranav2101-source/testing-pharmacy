import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";
import { CalendarService } from "./calendar.service.js";
import {
  CreateCalendarEventSchema,
  UpdateCalendarEventSchema,
  CalendarQuerySchema,
} from "./calendar.schema.js";

const calendarRoutes: FastifyPluginAsync = async (app) => {
  const service = new CalendarService(app);
  const auth    = [authenticate, resolvePharmacy];

  // GET /calendar/events?from=ISO&to=ISO
  app.get("/events", { preHandler: auth }, async (req, reply) => {
    const query = CalendarQuerySchema.parse(req.query);
    const data  = await service.getEvents(req.pharmacyId, query);
    return reply.send({ success: true, data });
  });

  // GET /calendar/today-count
  app.get("/today-count", { preHandler: auth }, async (req, reply) => {
    const count = await service.getTodayCount(req.pharmacyId);
    return reply.send({ success: true, data: { count } });
  });

  // POST /calendar/events
  app.post("/events", { preHandler: auth }, async (req, reply) => {
    const input = CreateCalendarEventSchema.parse(req.body);
    const event = await service.createEvent(req.pharmacyId, req.user.sub, input);
    return reply.status(201).send({ success: true, data: event });
  });

  // PATCH /calendar/events/:id
  app.patch("/events/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input  = UpdateCalendarEventSchema.parse(req.body);
    const event  = await service.updateEvent(id, req.pharmacyId, input);
    return reply.send({ success: true, data: event });
  });

  // DELETE /calendar/events/:id
  app.delete("/events/:id", { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deleteEvent(id, req.pharmacyId);
    return reply.send({ success: true });
  });
};

export default calendarRoutes;
