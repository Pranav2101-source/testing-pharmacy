import type { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";
import { TtlCache } from "../lib/ttl-cache.js";

export type UserRole = "OWNER" | "MANAGER" | "PHARMACIST" | "CASHIER" | "SUPPORT_AGENT" | "PLATFORM_ADMIN";

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

function parseTtlToSeconds(ttl: string): number {
  const match = ttl.match(/^(\d+)(m|h|d)$/);
  if (!match) return 15 * 60;
  const n    = parseInt(match[1]!, 10);
  const unit = match[2];
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 60 * 60;
  return n * 24 * 60 * 60;
}

const TOKEN_VERSION_TTL_S = parseTtlToSeconds(env.JWT_EXPIRES_IN);

// In-process token version cache. Eliminates a DB round-trip on every
// authenticated request. Eviction on logout/password-change is synchronous —
// no network hop required (compare: Redis del was async + could fail).
// Cache miss falls through to Prisma and re-populates transparently.
const tokenVersionCache = new TtlCache<string, number>();

// Exported so auth.service.ts can invalidate on logout / password change.
export function invalidateTokenVersion(userId: string): void {
  tokenVersionCache.delete(userId);
}

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

  const { sub: userId, tokenVersion } = request.user;

  let currentVersion = tokenVersionCache.get(userId);

  if (currentVersion === undefined) {
    const user = await request.server.prisma.user.findUnique({
      where:  { id: userId },
      select: { tokenVersion: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return void reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    currentVersion = user.tokenVersion;
    tokenVersionCache.set(userId, currentVersion, TOKEN_VERSION_TTL_S);
  }

  if (tokenVersion !== currentVersion) {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

/**
 * Factory that returns a preHandler which passes only if the authenticated
 * user holds one of the specified roles. Must come AFTER `authenticate`.
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

export const requireOwner   = requireRole("OWNER");
export const requireManager = requireRole("OWNER", "MANAGER");
