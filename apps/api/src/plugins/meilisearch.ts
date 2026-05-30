import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { MeiliSearch } from "meilisearch";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    meilisearch: MeiliSearch;
  }
}

const meilisearchPlugin: FastifyPluginAsync = async (fastify) => {
  const client = new MeiliSearch({
    host: env.MEILISEARCH_HOST,
    apiKey: env.MEILISEARCH_API_KEY,
  });

  // Ensure medicine index exists with proper settings
  const index = client.index("medicines");
  await index.updateSettings({
    searchableAttributes: ["name", "genericName", "manufacturer", "composition"],
    filterableAttributes: ["category", "schedule", "gstRate", "isActive"],
    sortableAttributes: ["name"],
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
  });

  fastify.decorate("meilisearch", client);

  // Auto-sync all medicines from Postgres to Meilisearch on startup
  fastify.addHook("onReady", async () => {
    try {
      const medicines = await fastify.prisma.medicine.findMany();
      if (medicines.length > 0) {
        await index.addDocuments(medicines);
        fastify.log.info(`Meilisearch: indexed ${medicines.length} medicines`);
      }
    } catch (err) {
      fastify.log.warn({ err }, "Meilisearch auto-sync failed — search may be empty");
    }
  });
};

export default fp(meilisearchPlugin, { name: "meilisearch" });
