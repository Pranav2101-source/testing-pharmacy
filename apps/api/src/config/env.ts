import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),

  // Comma-separated list of allowed CORS origins — supports multiple frontends / mobile apps
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),

  // Number of reverse-proxy hops in front of the API (load balancer, CDN, etc.).
  // Used for Fastify's trustProxy so req.ip resolves to the real client address.
  // NEVER set higher than the actual hop count — extra hops let clients spoof
  // their IP via X-Forwarded-For and bypass IP-keyed rate limits (incl. the
  // login brute-force limit). Unset defaults: 1 in production, 0 in development.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),

  DATABASE_URL: z.string().min(1),

  // Direct (non-pooled) connection — required for pg-boss (LISTEN/NOTIFY) and
  // Prisma migrations. On Supabase: port 5432. On Neon: the non-pooler URL.
  DIRECT_URL: z.string().min(1),

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

  // Supabase Storage — service role key gives server-side access (bypasses RLS).
  // SUPABASE_URL: Project URL from Supabase dashboard → Settings → API
  // SUPABASE_SERVICE_ROLE_KEY: Secret key — never expose to the frontend.
  SUPABASE_URL:              z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET:   z.string().default("pharmacy-docs"),

  // Redis — optional. When set, rate limiting uses a shared Redis counter so the
  // per-IP brute-force limit is enforced across ALL instances (Fly.io, AWS ALB, etc.).
  // Omit in local dev; set in production via secrets (Upstash, ElastiCache, etc.).
  REDIS_URL: z.string().optional(),

  RAZORPAY_KEY_ID:     z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  // Set to true to skip pg-boss worker initialization (CI, minimal dev environments).
  DISABLE_QUEUES: z.coerce.boolean().default(false),
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

/**
 * Proxy hops to trust for client-IP resolution. Production platforms (Railway,
 * Render, Fly, ALB) put exactly one proxy in front; local dev connects directly,
 * where trusting any hop would let a client spoof X-Forwarded-For.
 */
export const trustProxyHops: number =
  env.TRUST_PROXY_HOPS ?? (env.NODE_ENV === "production" ? 1 : 0);
