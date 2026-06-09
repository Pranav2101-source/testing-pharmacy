import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
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
import purchasesRoutes from "./modules/purchases/purchases.routes.js";
import supplierReturnsRoutes from "./modules/supplier-returns/supplier-returns.routes.js";
import supplierPaymentsRoutes from "./modules/supplier-payments/supplier-payments.routes.js";
import supplierCreditNotesRoutes from "./modules/supplier-credit-notes/supplier-credit-notes.routes.js";
import quotationsRoutes from "./modules/quotations/quotations.routes.js";
import brandsRoutes from "./modules/brands/brands.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import staffRoutes from "./modules/staff/staff.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import uploadsRoutes from "./modules/uploads/uploads.routes.js";
import notificationsRoutes from "./modules/notifications/notifications.routes.js";
import customersRoutes from "./modules/customers/customers.routes.js";
import locationsRoutes from "./modules/locations/locations.routes.js";
import stockAuditRoutes from "./modules/stock-audit/stock-audit.routes.js";
import calendarRoutes from "./modules/calendar/calendar.routes.js";
import pharmacyRoutes from "./modules/pharmacy/pharmacy.routes.js";

import { env, allowedOrigins } from "./config/env.js";
import { AppError } from "./lib/AppError.js";

// ── Queue workers (import side-effect: registers each BullMQ Worker) ──────────
import "./queues/processors/expiry-alert.processor.js";
import "./queues/processors/low-stock-alert.processor.js";
import "./queues/processors/grn-overdue.processor.js";
import "./queues/processors/eod-summary.processor.js";
import "./queues/processors/quotation-expiry.processor.js";
import "./queues/processors/pending-credit.processor.js";
import "./queues/processors/calendar-digest.processor.js";
import "./queues/processors/post-invoice.processor.js";

import { setupScheduledJobs } from "./queues/scheduler.js";

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
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) { cb(null, true); return; }
      if (allowedOrigins.includes(origin)) { cb(null, true); return; }
      cb(new Error(`CORS: origin ${origin} not allowed`), false);
    },
    credentials: true,
  });

  // ── Plugins (registered early so Redis is available to rate-limit) ────────
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(meilisearchPlugin);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max CSV

  // Global rate limit backed by Redis — counts are shared across all API
  // instances so a client cannot bypass the limit by hitting different pods.
  await app.register(rateLimit, {
    global:     true,
    max:        200,
    timeWindow: "1 minute",
    redis:      app.redis,
    keyGenerator: (req) => req.ip,
  });

  // ── Auth ──────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret:    env.JWT_SECRET,
    sign:      { expiresIn: env.JWT_EXPIRES_IN },
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

  // ── Routes ────────────────────────────────────────────────────────────────
  // Auth routes get their own stricter rate limit (brute force / credential stuffing mitigation)
  await app.register(
    async (authApp) => {
      authApp.addHook("onRequest", async (req, reply) => {
        // Only apply the tight limit to state-mutating auth endpoints
        const sensitiveRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];
        const isSensitive = sensitiveRoutes.some((r) => req.url.endsWith(r));
        if (!isSensitive) return;
        try {
          // @ts-expect-error — fastify-rate-limit augments the reply
          await reply.rateLimit({ max: 10, timeWindow: "1 minute", keyGenerator: () => req.ip });
        } catch {
          // rateLimit exceeded — let the global handler return 429
        }
      });
      await authApp.register(authRoutes, { prefix: "/api/auth" });
    },
    {},
  );

  await app.register(billingRoutes,       { prefix: "/api/billing" });
  await app.register(inventoryRoutes,     { prefix: "/api/inventory" });
  await app.register(medicinesRoutes,     { prefix: "/api/medicines" });
  await app.register(suppliersRoutes,     { prefix: "/api/suppliers" });
  await app.register(purchasesRoutes,           { prefix: "/api/purchases" });
  await app.register(supplierReturnsRoutes,     { prefix: "/api/supplier-returns" });
  await app.register(supplierPaymentsRoutes,    { prefix: "/api/supplier-payments" });
  await app.register(supplierCreditNotesRoutes, { prefix: "/api/supplier-credit-notes" });
  await app.register(quotationsRoutes,          { prefix: "/api/quotations" });
  await app.register(brandsRoutes,              { prefix: "/api/brands" });
  await app.register(categoriesRoutes,    { prefix: "/api/categories" });
  await app.register(reportsRoutes,       { prefix: "/api/reports" });
  await app.register(staffRoutes,         { prefix: "/api/staff" });
  await app.register(auditRoutes,         { prefix: "/api/audit" });
  await app.register(uploadsRoutes,       { prefix: "/api/uploads" });
  await app.register(notificationsRoutes, { prefix: "/api/notifications" });
  await app.register(customersRoutes,     { prefix: "/api/customers" });
  await app.register(locationsRoutes,     { prefix: "/api/locations" });
  await app.register(stockAuditRoutes,    { prefix: "/api/stock-audit" });
  await app.register(calendarRoutes,      { prefix: "/api/calendar" });
  await app.register(pharmacyRoutes,      { prefix: "/api/pharmacy" });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // ── Scheduled jobs ────────────────────────────────────────────────────────
  // Register cron jobs on startup; BullMQ deduplicates repeatable jobs automatically.
  setupScheduledJobs().catch((err) => app.log.error(err, "Failed to setup scheduled jobs"));

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error:   "Validation failed",
        details: error.flatten().fieldErrors,
      });
    }

    const status: number =
      error instanceof AppError
        ? error.statusCode
        : typeof (error as any).statusCode === "number"
          ? (error as any).statusCode
          : 500;

    if (status >= 500) app.log.error(error);

    return reply.status(status).send({
      success: false,
      error:   status >= 500 ? "Internal server error" : error.message,
    });
  });

  return app;
}
