import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

// Last-resort safety net: log unhandled rejections / exceptions instead of
// crashing the process. BullMQ workers and ioredis can occasionally emit
// rejection chains (e.g. "Connection is closed" during a Redis rate-limit
// event) that escape their own error handlers. Without this, Node.js ≥ 15
// terminates the process on any unhandled rejection.
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err: Error) => {
  console.error("[process] Uncaught exception:", err);
});

const app = await buildApp();

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
