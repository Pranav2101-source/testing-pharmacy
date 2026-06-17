import type { FastifyRequest, FastifyReply } from "fastify";

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

// No in-process cache here — token version is always read from the DB so that
// a logout (or password change) on any instance takes effect across all
// instances immediately. The extra DB round-trip costs ~1 ms on Supabase and
// is negligible for a pharmacy workload.

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

  const user = await request.server.prisma.user.findUnique({
    where:  { id: userId },
    select: { tokenVersion: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }

  if (tokenVersion !== user.tokenVersion) {
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
