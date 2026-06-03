import type { FastifyPluginAsync } from "fastify";
import { AuthService } from "./auth.service.js";
import {
  loginSchema,
  registerSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.schema.js";
import { authenticate } from "../../middleware/auth.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);

  app.post("/register", async (req, reply) => {
    const input  = registerSchema.parse(req.body);
    const tokens = await service.register(input);
    return reply.status(201).send({ success: true, data: tokens });
  });

  app.post("/login", async (req, reply) => {
    const input  = loginSchema.parse(req.body);
    const result = await service.login(input);
    return reply.send({ success: true, data: result });
  });

  app.post("/refresh", async (req, reply) => {
    const input  = refreshSchema.parse(req.body);
    const tokens = await service.refresh(input);
    return reply.send({ success: true, data: tokens });
  });

  // Returns 200 even when email is not registered — prevents enumeration
  app.post("/forgot-password", async (req, reply) => {
    const input = forgotPasswordSchema.parse(req.body);
    await service.forgotPassword(input);
    return reply.send({ success: true, data: { message: "If that email is registered you will receive a reset link shortly" } });
  });

  app.post("/reset-password", async (req, reply) => {
    const input = resetPasswordSchema.parse(req.body);
    await service.resetPassword(input);
    return reply.send({ success: true, data: { message: "Password updated — please log in with your new credentials" } });
  });

  app.get("/me", { preHandler: authenticate }, async (req, reply) => {
    const user = await app.prisma.user.findUnique({
      where:  { id: req.user.sub },
      select: {
        id:        true,
        name:      true,
        email:     true,
        role:      true,
        pharmacyId: true,
        pharmacy:  { select: { name: true, gstin: true, drugLicense: true } },
      },
    });
    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }
    return reply.send({ success: true, data: user });
  });
};

export default authRoutes;
