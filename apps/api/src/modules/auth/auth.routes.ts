import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { AuthService } from "./auth.service.js";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "./auth.schema.js";
import { authenticate } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { auditService } from "../audit/audit.service.js";

// ── Refresh-token cookie helpers ──────────────────────────────────────────────
// The refresh token never travels through JavaScript-readable storage. It lives
// exclusively in an httpOnly cookie, invisible to any injected script (XSS).
// The access token is short-lived (JWT_EXPIRES_IN) and kept in JS memory only.

const REFRESH_COOKIE    = "refresh_token";
const REFRESH_MAX_AGE_S = 7 * 24 * 60 * 60; // 7 days, matches auth.service signTokens

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Secure is required in production (HTTPS). Local dev runs on HTTP so we
    // skip it there; it would cause browsers to silently drop the cookie.
    secure:   env.NODE_ENV === "production",
    // SameSite=None is required when the frontend and API are on different
    // origins (Vercel ↔ Fly.io, Amplify ↔ ALB, etc.). SameSite=Lax is
    // sufficient for same-origin local dev and is more restrictive.
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    // Scope the cookie to auth endpoints only — the browser never sends it
    // to /api/v1/billing/invoices or any other route. Least privilege.
    path:     "/api/v1/auth",
    maxAge:   REFRESH_MAX_AGE_S,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, {
    path:     "/api/v1/auth",
    httpOnly: true,
    secure:   env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Per-route limit for credential/token endpoints — stricter than the 200/min global.
// In test mode mirror the global's 999_999 cap so integration tests never hit 429.
const AUTH_RATE_LIMIT = {
  max:        env.NODE_ENV === "test" ? 999_999 : 10,
  timeWindow: "1 minute",
};

const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);

  app.post("/register", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const input  = registerSchema.parse(req.body);
    const result = await service.register(req, input);
    setRefreshCookie(reply, result.tokens.refreshToken);
    return reply.status(201).send({ success: true, data: { accessToken: result.tokens.accessToken, user: result.user } });
  });

  app.post("/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const input  = loginSchema.parse(req.body);
    const result = await service.login(input);
    setRefreshCookie(reply, result.tokens.refreshToken);
    
    void auditService.log(req, {
      pharmacyId: result.user.pharmacyId,
      userId:     result.user.id,
      userEmail:  result.user.email,
      module:     "AUTH",
      action:     "LOGIN_SUCCESS",
      entity:     "User",
      entityId:   result.user.id,
      severity:   "INFO",
      status:     "SUCCESS",
    });

    return reply.send({
      success: true,
      data: {
        tokens: { accessToken: result.tokens.accessToken },
        user:   result.user,
      },
    });
  });

  // The refresh token is read from the httpOnly cookie — no body parsing needed.
  // Origin check provides CSRF protection: a cross-site form POST cannot fake
  // the Origin header, and even if it triggers a rotation, the attacker's page
  // cannot read the new access token (CORS blocks the response body).
  app.post("/refresh", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const refreshToken = req.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      return reply.status(401).send({ success: false, error: "No refresh token" });
    }
    const tokens = await service.refresh(refreshToken);
    setRefreshCookie(reply, tokens.refreshToken);
    return reply.send({ success: true, data: { accessToken: tokens.accessToken } });
  });

  // Returns 200 even when email is not registered — prevents enumeration
  app.post("/forgot-password", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const input = forgotPasswordSchema.parse(req.body);
    await service.forgotPassword(input);
    return reply.send({ success: true, data: { message: "If that email is registered you will receive a reset link shortly" } });
  });

  app.post("/reset-password", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const input = resetPasswordSchema.parse(req.body);
    await service.resetPassword(input);
    return reply.send({ success: true, data: { message: "Password updated — please log in with your new credentials" } });
  });

  // Rate-limited like other credential endpoints; authenticated so we know who is changing it.
  app.patch("/change-password", { preHandler: authenticate, config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const input = changePasswordSchema.parse(req.body);
    await service.changePassword(req.user.sub, input);
    // Intentionally do NOT issue new tokens here — the client must re-authenticate.
    clearRefreshCookie(reply);
    return reply.send({ success: true, data: { message: "Password updated — please sign in again" } });
  });

  app.post("/logout", { preHandler: authenticate }, async (req, reply) => {
    await service.logout(req.user.sub);
    clearRefreshCookie(reply);
    
    void auditService.log(req, {
      pharmacyId: req.user.pharmacyId,
      userId:     req.user.sub,
      module:     "AUTH",
      action:     "LOGOUT",
      entity:     "User",
      entityId:   req.user.sub,
      severity:   "INFO",
      status:     "SUCCESS",
    });

    return reply.send({ success: true, data: { message: "Logged out" } });
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

  app.patch("/me", { preHandler: authenticate }, async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      return reply.status(400).send({ success: false, error: "Name is required" });
    }
    const user = await app.prisma.user.update({
      where:  { id: req.user.sub },
      data:   { name: name.trim() },
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        pharmacyId: true,
        pharmacy:   { select: { name: true } },
      },
    });
    return reply.send({ success: true, data: user });
  });
};

export default authRoutes;
