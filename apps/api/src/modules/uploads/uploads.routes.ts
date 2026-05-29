import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolveTenant } from "../../middleware/tenant.js";

const uploadsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolveTenant];

  app.post("/prescription", { preHandler }, async (req, reply) => {
    // Multipart upload handled here — integrate with Cloudflare R2
    // Placeholder: implement R2 upload in production
    return reply.status(501).send({ success: false, error: "Upload service not configured" });
  });

  app.get("/", { preHandler }, async (req, reply) => {
    const { type } = req.query as Record<string, string>;
    const uploads = await app.prisma.upload.findMany({
      where: { tenantId: req.tenantId, ...(type ? { type: type as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reply.send({ success: true, data: uploads });
  });
};

export default uploadsRoutes;
