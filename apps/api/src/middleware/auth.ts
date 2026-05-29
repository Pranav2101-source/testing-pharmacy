import type { FastifyRequest, FastifyReply } from "fastify";

export type JwtPayload = {
  sub: string;       // userId
  tenantId: string;
  role: "OWNER" | "PHARMACIST";
  email: string;
};

declare module "fastify" {
  interface FastifyRequest {
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
    reply.status(401).send({ success: false, error: "Unauthorized" });
  }
}

export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await authenticate(request, reply);
  if (request.user?.role !== "OWNER") {
    reply.status(403).send({ success: false, error: "Forbidden: Owner access required" });
  }
}
