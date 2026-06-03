import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolvePharmacy];

  // Last 50 notification logs — newest first
  app.get("/logs", { preHandler }, async (req, reply) => {
    const logs = await app.prisma.notificationLog.findMany({
      where:   { pharmacyId: req.pharmacyId },
      orderBy: { createdAt: "desc" },
      take:    50,
    });
    return reply.send({ success: true, data: logs });
  });

  // Count unread (isRead = false) notifications
  app.get("/unread-count", { preHandler }, async (req, reply) => {
    const count = await app.prisma.notificationLog.count({
      where: { pharmacyId: req.pharmacyId, isRead: false },
    });
    return reply.send({ success: true, data: { count } });
  });

  // Mark ALL notifications as read for this pharmacy
  app.patch("/mark-read", { preHandler }, async (req, reply) => {
    await app.prisma.notificationLog.updateMany({
      where: { pharmacyId: req.pharmacyId, isRead: false },
      data:  { isRead: true },
    });
    return reply.send({ success: true });
  });

  // Mark a single notification as read
  app.patch("/:id/read", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await app.prisma.notificationLog.updateMany({
      where: { id, pharmacyId: req.pharmacyId },
      data:  { isRead: true },
    });
    return reply.send({ success: true });
  });

  // Recent failed notifications (for diagnostics)
  app.get("/failed", { preHandler }, async (req, reply) => {
    const logs = await app.prisma.notificationLog.findMany({
      where:   { pharmacyId: req.pharmacyId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take:    20,
    });
    return reply.send({ success: true, data: logs });
  });
};

export default notificationsRoutes;
