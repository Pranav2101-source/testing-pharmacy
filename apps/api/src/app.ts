import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";

import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import meilisearchPlugin from "./plugins/meilisearch.js";

import authRoutes from "./modules/auth/auth.routes.js";
import billingRoutes from "./modules/billing/billing.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import medicinesRoutes from "./modules/medicines/medicines.routes.js";
import suppliersRoutes from "./modules/suppliers/suppliers.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import staffRoutes from "./modules/staff/staff.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import uploadsRoutes from "./modules/uploads/uploads.routes.js";
import notificationsRoutes from "./modules/notifications/notifications.routes.js";
import customersRoutes from "./modules/customers/customers.routes.js";

import { env } from "./config/env.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "warn" : "info",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
  });

  // ── Security ──────────────────────────────────────────────────────────────
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  // ── Auth ──────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // ── Docs (dev only) ───────────────────────────────────────────────────────
  if (env.NODE_ENV !== "production") {
    await app.register(swagger, {
      openapi: {
        info: { title: "Checkup Pharmacy API", version: "1.0.0" },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  // ── Plugins ───────────────────────────────────────────────────────────────
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(meilisearchPlugin);

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(billingRoutes, { prefix: "/api/billing" });
  await app.register(inventoryRoutes, { prefix: "/api/inventory" });
  await app.register(medicinesRoutes, { prefix: "/api/medicines" });
  await app.register(suppliersRoutes, { prefix: "/api/suppliers" });
  await app.register(reportsRoutes, { prefix: "/api/reports" });
  await app.register(staffRoutes, { prefix: "/api/staff" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(uploadsRoutes, { prefix: "/api/uploads" });
  await app.register(notificationsRoutes, { prefix: "/api/notifications" });
  await app.register(customersRoutes,     { prefix: "/api/customers" });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    // Zod validation errors thrown by schema.parse() in route handlers
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: error.flatten().fieldErrors,
      });
    }

    const status: number =
      typeof (error as any).statusCode === "number" ? (error as any).statusCode : 500;

    if (status >= 500) {
      app.log.error(error);
    }

    return reply.status(status).send({
      success: false,
      error: status >= 500 ? "Internal server error" : error.message,
    });
  });

  return app;
}
