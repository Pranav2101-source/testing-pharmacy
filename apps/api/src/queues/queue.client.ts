import { Queue, Worker } from "bullmq";
import { env } from "../config/env.js";

const connection = { url: env.REDIS_URL };

export const notificationQueue = new Queue("notifications", { connection });
export const reportQueue = new Queue("reports", { connection });
export const expiryAlertQueue = new Queue("expiry-alerts", { connection });

export { connection };
