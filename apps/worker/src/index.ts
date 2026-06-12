import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";

// Load root .env before @pharmacy/jobs is imported — boss.ts reads DATABASE_URL
// at module evaluation time, so dotenv must run first. In ESM, static imports
// are hoisted, so @pharmacy/jobs must be a dynamic import that runs after this.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const log = pino({
  level: process.env.NODE_ENV === "production" ? "warn" : "info",
  ...(process.env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

if (process.env.DISABLE_QUEUES === "true") {
  log.info("[worker] DISABLE_QUEUES=true — exiting without starting workers");
  process.exit(0);
}

const missing = ["DATABASE_URL"].filter((k) => !process.env[k]);
if (missing.length) {
  log.error({ missing }, "[worker] Missing required environment variables");
  process.exit(1);
}

process.on("unhandledRejection", (reason: unknown) => {
  log.error({ reason }, "[process] Unhandled promise rejection");
});
process.on("uncaughtException", (err: Error) => {
  log.error({ err: err.message }, "[process] Uncaught exception");
});

// Dynamic import so boss.ts evaluates only after DATABASE_URL is in process.env
const { startWorkers, setupScheduledJobs } = await import("@pharmacy/jobs");

await startWorkers();
setupScheduledJobs().catch((err) => log.error(err, "[worker] Failed to setup scheduled jobs"));
log.info("[worker] All workers started and scheduled jobs registered");
