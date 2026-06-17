import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err: Error) => {
  console.error("[process] Uncaught exception:", err);
});

const app = await buildApp();

// Graceful shutdown: Fly.io (and AWS ECS/ALB) send SIGTERM before killing the
// container. Calling app.close() triggers the onClose hooks — including
// boss.stop() which drains in-flight pg-boss jobs and the Redis quit() call.
// Fly waits kill_timeout seconds (set to 30s in fly.toml) before SIGKILL,
// which is enough for short pharmacy jobs to finish.
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info(`[server] ${signal} received — shutting down gracefully`);
  try {
    await app.close();
    app.log.info("[server] shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error(err, "[server] error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => void gracefulShutdown("SIGINT"));

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  console.log(`API running at http://${env.API_HOST}:${env.API_PORT}`);
  if (env.NODE_ENV !== "production") {
    console.log(`Swagger docs: http://localhost:${env.API_PORT}/docs`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
