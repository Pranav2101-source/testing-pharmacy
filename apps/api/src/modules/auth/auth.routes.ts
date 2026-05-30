import type { FastifyPluginAsync } from "fastify";
import { AuthService } from "./auth.service.js";
import { loginSchema, registerSchema, refreshSchema } from "./auth.schema.js";
import { authenticate } from "../../middleware/auth.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);

  app.post("/register", async (req, reply) => {
    const input = registerSchema.parse(req.body);
    const tokens = await service.register(input);
    return reply.status(201).send({ success: true, data: tokens });
  });

  app.post("/login", async (req, reply) => {
    const input = loginSchema.parse(req.body);
    const result = await service.login(input);
    return reply.send({ success: true, data: result });
  });

  /**
   * Exchange a valid refresh token for a new access + refresh token pair.
   * Callers should discard the old refresh token after this call (rotation).
   */
  app.post("/refresh", async (req, reply) => {
    const input = refreshSchema.parse(req.body);
    const tokens = await service.refresh(input);
    return reply.send({ success: true, data: tokens });
  });

  app.get("/me", { preHandler: authenticate }, async (req, reply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tenantId: true,
        tenant: { select: { name: true, gstin: true, drugLicense: true } },
      },
    });
    if (!user) {
      // Token was valid but user was deleted from DB after token issuance
      return reply.status(404).send({ success: false, error: "User not found" });
    }
    return reply.send({ success: true, data: user });
  });
};

export default authRoutes;
