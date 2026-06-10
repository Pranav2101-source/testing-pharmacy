import type { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";

export type UserRole = "OWNER" | "MANAGER" | "PHARMACIST" | "CASHIER";

export type JwtPayload = {
  sub:          string;
  pharmacyId:   string;
  role:         UserRole;
  email:        string;
  tokenVersion: number;
  type:         "access" | "refresh";
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user:    JwtPayload;
  }
}

// Redis key that caches a user's current tokenVersion.
// TTL is derived from JWT_EXPIRES_IN so the cache never outlives a valid token,
// regardless of how the env var is configured.
export const tokenVersionKey = (userId: string) => `user:tv:${userId}`;

function parseTtlToSeconds(ttl: string): number {
  const match = ttl.match(/^(\d+)(m|h|d)$/);
  if (!match) return 15 * 60; // fallback: 15 min
  const n    = parseInt(match[1]!, 10);
  const unit = match[2];
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 60 * 60;
  return n * 24 * 60 * 60; // days
}

const TOKEN_VERSION_TTL_S = parseTtlToSeconds(env.JWT_EXPIRES_IN);

export async function authenticate(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }
  if (request.user.type === "refresh") {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }

  // Verify tokenVersion — ensures logout and password-reset actually revoke tokens.
  // Redis cache avoids a DB hit on every request; a cache miss falls through to Prisma
  // and re-populates the cache. Worst-case revocation latency = TOKEN_VERSION_TTL_S.
  const { sub: userId, tokenVersion } = request.user;
  const cacheKey = tokenVersionKey(userId);
  const { redis, prisma } = request.server;

  let currentVersion: number;
  const cached = await redis.get(cacheKey);

  if (cached !== null) {
    currentVersion = parseInt(cached, 10);
  } else {
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { tokenVersion: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return void reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    currentVersion = user.tokenVersion;
    await redis.set(cacheKey, String(currentVersion), "EX", TOKEN_VERSION_TTL_S);
  }

  if (tokenVersion !== currentVersion) {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

/**
 * Factory that returns a preHandler which passes only if the authenticated
 * user holds one of the specified roles. Must come AFTER `authenticate`.
 *
 * Usage:
 *   const owner   = [authenticate, resolvePharmacy, requireRole("OWNER")];
 *   const manager = [authenticate, resolvePharmacy, requireRole("OWNER", "MANAGER")];
 */
export function requireRole(...roles: UserRole[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply:   FastifyReply,
  ): Promise<void> {
    if (reply.sent) return;
    if (!roles.includes(request.user?.role)) {
      return void reply.status(403).send({
        success: false,
        error:   `Forbidden: requires one of [${roles.join(", ")}]`,
      });
    }
  };
}

/** Convenience: only OWNER may proceed. */
export const requireOwner = requireRole("OWNER");

/** OWNER or MANAGER — for admin-level operations that don't need full owner access. */
export const requireManager = requireRole("OWNER", "MANAGER");
