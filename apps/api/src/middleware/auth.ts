import type { FastifyRequest, FastifyReply } from "fastify";

export type JwtPayload = {
  sub: string;
  tenantId: string;
  role: "OWNER" | "PHARMACIST";
  email: string;
  /** Discriminates access tokens from refresh tokens.
   *  Legacy tokens issued before this field was added have no `type`;
   *  they are treated as access tokens for backwards compatibility. */
  type?: "access" | "refresh";
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }
  // Prevent refresh tokens from being used as access tokens
  if (request.user.type === "refresh") {
    return void reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

/**
 * Must be placed AFTER `authenticate` in the preHandler array.
 * Only checks the role; JWT verification is already done by `authenticate`.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (reply.sent) return; // upstream preHandler already rejected the request
  if (request.user?.role !== "OWNER") {
    return void reply.status(403).send({ success: false, error: "Forbidden: Owner access required" });
  }
}
