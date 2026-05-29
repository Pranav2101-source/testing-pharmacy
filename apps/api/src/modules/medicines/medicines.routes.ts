import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";

const medicinesRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate];

  // Fast fuzzy search via Meilisearch
  app.get("/search", { preHandler }, async (req, reply) => {
    const { q = "", limit = "10" } = req.query as Record<string, string>;
    const results = await app.meilisearch
      .index("medicines")
      .search(q, { limit: Number(limit), attributesToRetrieve: [
        "id", "name", "genericName", "manufacturer", "form",
        "strength", "packSize", "hsnCode", "gstRate", "schedule",
      ]});
    return reply.send({ success: true, data: results.hits });
  });

  // Get medicine by ID (from Postgres for full detail)
  app.get("/:id", { preHandler }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const medicine = await app.prisma.medicine.findUnique({ where: { id } });
    if (!medicine) return reply.status(404).send({ success: false, error: "Not found" });
    return reply.send({ success: true, data: medicine });
  });
};

export default medicinesRoutes;
