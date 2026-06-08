import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),

  // Comma-separated list of allowed CORS origins — supports multiple frontends / mobile apps
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  MEILISEARCH_HOST:    z.string().default("http://localhost:7700"),
  MEILISEARCH_API_KEY: z.string().min(1),

  JWT_SECRET:              z.string().min(32),
  JWT_EXPIRES_IN:          z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN:  z.string().default("7d"),

  // Password reset token TTL (e.g. "1h", "30m")
  PASSWORD_RESET_TOKEN_TTL: z.string().default("1h"),

  // How long a stock reservation lives before being auto-released (minutes)
  RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  // PostgreSQL connection pool — tune based on available DB connections and
  // expected concurrent API + worker process count.
  // pool_timeout: seconds a query waits for a free connection before erroring.
  DB_POOL_SIZE:    z.coerce.number().int().positive().default(10),
  DB_POOL_TIMEOUT: z.coerce.number().int().positive().default(10),

  // Optional SMTP — required in production if password reset emails are enabled
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("noreply@checkup.app"),

  R2_ACCOUNT_ID:       z.string().optional(),
  R2_ACCESS_KEY_ID:    z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME:      z.string().optional(),
  R2_PUBLIC_URL:       z.string().optional(),

  RAZORPAY_KEY_ID:     z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Missing or invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  console.error("Copy .env.example to .env and fill in the required values.");
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Parsed array of allowed CORS origins from the ALLOWED_ORIGINS env variable. */
export const allowedOrigins: string[] = env.ALLOWED_ORIGINS
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
