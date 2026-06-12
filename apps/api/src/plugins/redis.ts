import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redis = new Redis(env.REDIS_URL, {
    // null = never close the connection after N failed commands (required for BullMQ interop)
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // Don't queue commands while disconnected — callers get instant errors so they
    // can fall back (auth middleware already falls back to DB when Redis is down).
    enableOfflineQueue: false,
  });

  // Without this listener, ioredis 'error' events become uncaughtExceptions and
  // crash the process. Redis is non-critical: auth falls back to DB, rate-limiting
  // falls back to in-memory. Log as warn so we see it without alarming.
  redis.on("error", (err: Error) => {
    fastify.log.warn({ err: err.message }, "[Redis] connection error — non-critical features degraded");
  });

  try {
    await redis.connect();
    fastify.log.info("[Redis] Connected");
  } catch (err) {
    fastify.log.warn({ err }, "[Redis] Could not connect on startup — Redis features unavailable");
  }

  fastify.decorate("redis", redis);
  fastify.addHook("onClose", async () => {
    try { await redis.quit(); } catch { /* ignore — already closed */ }
  });
};

export default fp(redisPlugin, { name: "redis" });
