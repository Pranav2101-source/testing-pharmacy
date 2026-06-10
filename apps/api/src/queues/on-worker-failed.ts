import type { Worker } from "bullmq";
import pino from "pino";
import { env } from "../config/env.js";

// Standalone logger for queue processors.  Processors run as BullMQ Workers
// outside the Fastify request context so they can't use `app.log` directly.
const log = pino({
  level: env.NODE_ENV === "production" ? "warn" : "info",
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/**
 * Attach a `failed` event listener that emits a structured ERROR log whenever
 * a BullMQ job exhausts all its retry attempts.
 *
 * BullMQ fires `failed` on every unsuccessful attempt.  We ignore intermediate
 * failures (which are retried) and only log when `attemptsMade >= maxAttempts`.
 *
 * Usage: call once per Worker after construction, e.g.
 *   export const myWorker = new Worker("my-queue", processor, { connection });
 *   onWorkerFailed(myWorker);
 */
export function onWorkerFailed(worker: Worker): void {
  worker.on("failed", (job, err) => {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    // Intermediate retry — don't alert yet
    if (job.attemptsMade < maxAttempts) return;

    // Final failure — log at ERROR so on-call / log aggregators pick it up
    log.error(
      {
        queue:        worker.name,
        jobId:        job.id,
        jobName:      job.name,
        attemptsMade: job.attemptsMade,
        data:         job.data,
        err,
      },
      `[BullMQ] Job "${job.name}" permanently failed on queue "${worker.name}" after ${job.attemptsMade} attempt(s)`,
    );
  });

  // Also log Worker-level errors (connection drops, Redis failures)
  worker.on("error", (err) => {
    log.error({ queue: worker.name, err }, `[BullMQ] Worker error on queue "${worker.name}"`);
  });
}
