import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
  }
}

export async function resolveTenant(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = request.user?.tenantId;
  if (!tenantId) {
    reply.status(401).send({ success: false, error: "Tenant not resolved" });
    return;
  }
  request.tenantId = tenantId;
}
