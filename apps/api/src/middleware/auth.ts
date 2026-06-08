import type { FastifyRequest, FastifyReply } from "fastify";

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
