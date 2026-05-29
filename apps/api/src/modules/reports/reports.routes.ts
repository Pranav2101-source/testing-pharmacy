import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const reportsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolveTenant];

  // Daily sales summary
  app.get("/sales/daily", { preHandler }, async (req, reply) => {
    const { date } = req.query as Record<string, string>;
    const day = date ? new Date(date) : new Date();
    const from = new Date(day.setHours(0, 0, 0, 0));
    const to = new Date(day.setHours(23, 59, 59, 999));

    const [invoices, totalRevenue] = await Promise.all([
      app.prisma.invoice.count({ where: { tenantId: req.tenantId, createdAt: { gte: from, lte: to }, isCancelled: false } }),
      app.prisma.invoice.aggregate({
        where: { tenantId: req.tenantId, createdAt: { gte: from, lte: to }, isCancelled: false },
        _sum: { totalAmount: true, totalGst: true },
      }),
    ]);

    return reply.send({
      success: true,
      data: {
        date: from,
        invoiceCount: invoices,
        revenue: totalRevenue._sum.totalAmount ?? 0,
        gstCollected: totalRevenue._sum.totalGst ?? 0,
      },
    });
  });

  // GST report for a period
  app.get("/gst", { preHandler }, async (req, reply) => {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to) return reply.status(400).send({ success: false, error: "from and to required" });

    const result = await app.prisma.invoice.aggregate({
      where: {
        tenantId: req.tenantId,
        createdAt: { gte: new Date(from), lte: new Date(to) },
        isCancelled: false,
      },
      _sum: { subtotal: true, discountAmount: true, taxableAmount: true, cgst: true, sgst: true, totalGst: true, totalAmount: true },
      _count: true,
    });

    return reply.send({ success: true, data: result });
  });

  // Expiry report
  app.get("/expiry", { preHandler }, async (req, reply) => {
    const threshold = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const items = await app.prisma.inventory.findMany({
      where: { tenantId: req.tenantId, expiryDate: { lte: threshold } },
      include: { medicine: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    });
    return reply.send({ success: true, data: items });
  });
};

export default reportsRoutes;
