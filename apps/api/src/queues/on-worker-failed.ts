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

// Per-worker flag: true while we've already logged a rate-limit hit and set a
// resume timer.  Prevents the tight BullMQ error-retry loop from flooding the
// terminal — BullMQ doesn't back off on errors, so without this every failed
// poll would emit an error event and log a multi-KB Buffer dump.
const pausedForRateLimit = new Set<string>();

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
        err:          (err as Error).message,
      },
      `[BullMQ] Job "${job.name}" permanently failed on queue "${worker.name}" after ${job.attemptsMade} attempt(s)`,
    );
  });

  // Worker-level errors (connection drops, Redis rate-limit, etc.)
  worker.on("error", (err: Error) => {
    if (err.message.includes("max requests limit exceeded")) {
      // BullMQ retries immediately on error (drainDelay only applies to empty
      // queues).  Without this guard the tight loop logs a multi-KB Buffer dump
      // every few ms until the daily quota resets.
      if (!pausedForRateLimit.has(worker.name)) {
        pausedForRateLimit.add(worker.name);
        log.warn(
          { queue: worker.name },
          `[BullMQ] Redis rate limit hit on "${worker.name}" — suppressing further errors for 5 min`,
        );
        // Best-effort pause; may itself fail if Redis is unavailable — that's fine.
        Promise.resolve(worker.pause()).catch(() => {});
        setTimeout(() => {
          pausedForRateLimit.delete(worker.name);
          Promise.resolve(worker.resume()).catch(() => {});
        }, 5 * 60 * 1000);
      }
      // else: already handling — swallow the repeated error silently
    } else {
      // For non-rate-limit errors log only the message, not the full serialised
      // Error which can include enormous command.args Buffer arrays from ioredis.
      log.error(
        { queue: worker.name, err: err.message },
        `[BullMQ] Worker error on queue "${worker.name}"`,
      );
    }
  });
}
