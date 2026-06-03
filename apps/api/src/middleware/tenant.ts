import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    pharmacyId: string;
  }
}

/**
 * Reads the `pharmacyId` claim from the verified JWT and attaches it to the
 * request. Must be placed AFTER `authenticate` in the preHandler array.
 */
export async function resolvePharmacy(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const pharmacyId = request.user?.pharmacyId;
  if (!pharmacyId) {
    reply.status(401).send({ success: false, error: "Pharmacy context could not be resolved" });
    return;
  }
  request.pharmacyId = pharmacyId;
}

// ── Backwards-compatible alias ────────────────────────────────────────────────
// Remove once all call sites have been updated to `resolvePharmacy`.
export const resolveTenant = resolvePharmacy;
