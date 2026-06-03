import type { FastifyRequest, FastifyReply } from "fastify";

export type JwtPayload = {
  sub:          string;
  pharmacyId:   string;
  role:         "OWNER" | "PHARMACIST";
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
 * Must come AFTER `authenticate` in the preHandler array.
 * Checks the OWNER role only — JWT verification is already done.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  if (reply.sent) return;
  if (request.user?.role !== "OWNER") {
    return void reply.status(403).send({ success: false, error: "Forbidden: owner access required" });
  }
}
