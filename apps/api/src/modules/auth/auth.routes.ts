import type { FastifyPluginAsync } from "fastify";
import { AuthService } from "./auth.service.js";
import { loginSchema, registerSchema } from "./auth.schema.js";
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

  app.get("/me", { preHandler: authenticate }, async (req, reply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true, name: true, email: true, role: true, tenantId: true,
        tenant: { select: { name: true, gstin: true, drugLicense: true } },
      },
    });
    return reply.send({ success: true, data: user });
  });
};

export default authRoutes;
