import Fastify from "fastify";
import compress from "@fastify/compress";
import cookie   from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Redis } from "ioredis";
import { ZodError } from "zod";

import prismaPlugin from "./plugins/prisma.js";
import meilisearchPlugin from "./plugins/meilisearch.js";
import storagePlugin from "./plugins/storage.js";

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
import supportRoutes    from "./modules/support/support.routes.js";
import doctorsRoutes    from "./modules/doctors/doctors.routes.js";
import cashClosureRoutes    from "./modules/cash-closure/cash-closure.routes.js";
import prescriptionsRoutes  from "./modules/prescriptions/prescriptions.routes.js";
import migrationRoutes      from "./modules/migration/migration.routes.js";

import { env, allowedOrigins, trustProxyHops } from "./config/env.js";
import { AppError } from "./lib/AppError.js";
import { Prisma } from "@pharmacy/database";

import { startWorkers, setupScheduledJobs, boss } from "@pharmacy/jobs";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "warn" : "info",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    // 1 MB hard cap on JSON/form request bodies. File uploads bypass this via
    // @fastify/multipart which enforces its own 25 MB per-file limit.
    bodyLimit: 1_048_576,
    // Trust exactly the configured number of proxy hops — `true` would trust any
    // client-supplied X-Forwarded-For, letting attackers spoof their IP and bypass
    // the IP-keyed rate limits (including the login brute-force limit).
    trustProxy: trustProxyHops > 0 ? trustProxyHops : false,
  });

  // ── Compression ───────────────────────────────────────────────────────────
  await app.register(compress, {
    global:    true,
    threshold: 1024,
    encodings: ["br", "gzip", "deflate"],
  });

  // ── Security ──────────────────────────────────────────────────────────────
  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) { cb(null, true); return; }
      if (allowedOrigins.includes(origin)) { cb(null, true); return; }
      cb(new Error(`CORS: origin ${origin} not allowed`), false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // ── Cookies ───────────────────────────────────────────────────────────────
  // Required for httpOnly refresh-token cookies. Must be registered before
  // auth routes so req.cookies is available when routes read the refresh cookie.
  await app.register(cookie);

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // When REDIS_URL is set (production), the counter is shared across all
  // instances so the brute-force limit is enforced fleet-wide — not just
  // per-process. Without REDIS_URL (local dev / CI), falls back to in-memory.
  let redisClient: Redis | undefined;
  if (env.REDIS_URL) {
    redisClient = new Redis(env.REDIS_URL, {
      connectTimeout:     5_000,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // fail fast if Redis is unreachable rather than queuing
      lazyConnect:        true,
    });
    redisClient.on("error", (err: Error) => {
      app.log.warn({ err }, "[redis] rate-limit store error");
    });
    try {
      await redisClient.connect();
      app.log.info("[redis] rate-limit store connected");
    } catch (err) {
      // Redis unavailable at startup — fall back to in-memory so the server
      // still starts. Log clearly so ops can react.
      app.log.error({ err }, "[redis] failed to connect — falling back to in-memory rate limiting");
      // disconnect() force-closes the socket immediately; quit() sends a QUIT
      // command which hangs when the connection was never established and causes
      // ioredis to keep emitting error events every ~2 s from its retry loop.
      redisClient.disconnect();
      redisClient = undefined;
    }
  }

  await app.register(rateLimit, {
    global:       true,
    max:          200,
    timeWindow:   "1 minute",
    keyGenerator: (req) => req.ip,
    ...(redisClient ? { redis: redisClient } : {}),
  });

  // Close the Redis connection cleanly when the app shuts down.
  if (redisClient) {
    app.addHook("onClose", async () => {
      await redisClient!.quit().catch((err: unknown) => {
        app.log.warn(err, "[redis] error during disconnect");
      });
    });
  }

  // ── Plugins ───────────────────────────────────────────────────────────────
  await app.register(prismaPlugin);
  await app.register(storagePlugin);
  await app.register(meilisearchPlugin);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

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
  await app.register(
    async (authApp) => {
      authApp.addHook("onRequest", async (req, reply) => {
        const sensitiveRoutes = ["/login", "/register", "/forgot-password", "/reset-password", "/refresh"];
        const isSensitive = sensitiveRoutes.some((r) => req.url.endsWith(r));
        if (!isSensitive) return;
        try {
          // @ts-expect-error — fastify-rate-limit augments the reply
          await reply.rateLimit({ max: 10, timeWindow: "1 minute", keyGenerator: () => req.ip });
        } catch {
          // rateLimit exceeded — let the global handler return 429
        }
      });
      await authApp.register(authRoutes, { prefix: "/api/v1/auth" });
    },
    {},
  );

  await app.register(billingRoutes,             { prefix: "/api/v1/billing" });
  await app.register(inventoryRoutes,           { prefix: "/api/v1/inventory" });
  await app.register(medicinesRoutes,           { prefix: "/api/v1/medicines" });
  await app.register(suppliersRoutes,           { prefix: "/api/v1/suppliers" });
  await app.register(purchasesRoutes,           { prefix: "/api/v1/purchases" });
  await app.register(supplierReturnsRoutes,     { prefix: "/api/v1/supplier-returns" });
  await app.register(supplierPaymentsRoutes,    { prefix: "/api/v1/supplier-payments" });
  await app.register(supplierCreditNotesRoutes, { prefix: "/api/v1/supplier-credit-notes" });
  await app.register(quotationsRoutes,          { prefix: "/api/v1/quotations" });
  await app.register(brandsRoutes,              { prefix: "/api/v1/brands" });
  await app.register(categoriesRoutes,          { prefix: "/api/v1/categories" });
  await app.register(reportsRoutes,             { prefix: "/api/v1/reports" });
  await app.register(staffRoutes,               { prefix: "/api/v1/staff" });
  await app.register(auditRoutes,               { prefix: "/api/v1/audit" });
  await app.register(uploadsRoutes,             { prefix: "/api/v1/uploads" });
  await app.register(notificationsRoutes,       { prefix: "/api/v1/notifications" });
  await app.register(customersRoutes,           { prefix: "/api/v1/customers" });
  await app.register(locationsRoutes,           { prefix: "/api/v1/locations" });
  await app.register(stockAuditRoutes,          { prefix: "/api/v1/stock-audit" });
  await app.register(calendarRoutes,            { prefix: "/api/v1/calendar" });
  await app.register(pharmacyRoutes,            { prefix: "/api/v1/pharmacy" });
  await app.register(supportRoutes,             { prefix: "/api/v1/support" });
  await app.register(doctorsRoutes,             { prefix: "/api/v1/doctors" });
  await app.register(cashClosureRoutes,         { prefix: "/api/v1/cash-closure" });
  await app.register(prescriptionsRoutes,       { prefix: "/api/v1/prescriptions" });
  await app.register(migrationRoutes,           { prefix: "/api/v1/migration" });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  app.get("/health/ready", async (_, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: "ready", ts: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ status: "unavailable", ts: new Date().toISOString() });
    }
  });

  // ── Queue workers + scheduled jobs ───────────────────────────────────────
  if (!env.DISABLE_QUEUES) {
    await startWorkers();
    await setupScheduledJobs();

    app.addHook("onClose", async () => {
      // 25 s budget — Fly sends SIGKILL at kill_timeout (30 s), leaving 5 s buffer.
      await boss.stop({ timeout: 25_000 }).catch((err: unknown) => {
        app.log.warn(err, "[pg-boss] error during shutdown");
      });
    });

    app.log.info("[pg-boss] workers started, schedules registered");
  } else {
    app.log.info("[Queues] DISABLE_QUEUES=true — skipping job workers");
  }

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error:   "Some information is missing or incorrect. Please check the form and try again.",
        details: error.flatten().fieldErrors,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case "P2002": {
          const fields = (error.meta?.target as string[] | undefined)?.join(", ") ?? "field";
          return reply.status(409).send({
            success: false,
            error:   `This ${fields} is already in use. Please use a different value.`,
          });
        }

        case "P2025":
          return reply.status(404).send({
            success: false,
            error:   "We couldn't find that item. It may have already been deleted.",
          });

        case "P2003":
          return reply.status(409).send({
            success: false,
            error:   "One of the linked items (like a supplier or medicine) could not be found. Please check your selection and try again.",
          });

        case "P2034":
          return reply.status(409).send({
            success:   false,
            error:     "Someone else updated this record at the same time. Please refresh the page and try again.",
            retryable: true,
          });

        case "P2024":
        case "P2028":
          app.log.error(error, `[Prisma] ${error.code} — DB capacity/timeout`);
          return reply.status(503).send({
            success:   false,
            error:     "The system is taking too long to respond. Please wait a moment and try again.",
            retryable: true,
          });

        default:
          app.log.error(error, `[Prisma] Unhandled error code ${error.code}`);
          return reply.status(500).send({
            success: false,
            error:   "Something went wrong on our end. Please try again, or contact support if this keeps happening.",
          });
      }
    }

    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError
    ) {
      app.log.error(error, "[Prisma] Critical database error");
      return reply.status(503).send({
        success:   false,
        error:     "We're unable to connect to the database right now. Please try again in a few moments.",
        retryable: true,
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
      error:   status >= 500
        ? "Something went wrong on our end. Please try again, or contact support if this keeps happening."
        : (error as Error).message ?? String(error),
      ...(error instanceof AppError && error.data ? error.data : {}),
    });
  });

  return app;
}
