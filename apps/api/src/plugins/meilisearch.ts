import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { MeiliSearch } from "meilisearch";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    meilisearch: MeiliSearch;
  }
}

// Redis key that tracks the last time we successfully pushed medicines to Meilisearch.
// Storing it per-environment prevents a staging restart from poisoning prod's cursor.
const SYNC_CURSOR_KEY = `meilisearch:medicines:lastSyncedAt:${env.NODE_ENV}`;

// Batch size for addDocuments — keeps individual Meilisearch requests under ~5 MB
const SYNC_BATCH_SIZE = 500;

const meilisearchPlugin: FastifyPluginAsync = async (fastify) => {
  const client = new MeiliSearch({
    host:   env.MEILISEARCH_HOST,
    apiKey: env.MEILISEARCH_API_KEY,
  });

  const index = client.index("medicines");

  // Create the index if it doesn't exist, then apply settings.
  // Both steps are best-effort — a MeiliSearch outage must never crash the API.
  try {
    await client.createIndex("medicines", { primaryKey: "id" });
  } catch {
    // Index already exists — fine, continue
  }
  try {
    await index.updateSettings({
      searchableAttributes: ["name", "genericName", "manufacturer", "composition"],
      filterableAttributes: ["category", "schedule", "gstRate", "isActive"],
      sortableAttributes:   ["name"],
      typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    });
  } catch (err) {
    fastify.log.warn({ err }, "Meilisearch: failed to configure index settings — search may be degraded");
  }

  fastify.decorate("meilisearch", client);

  // Incremental sync on startup:
  //   1. Read lastSyncedAt cursor from Redis.
  //   2. Fetch only medicines updated after that cursor (or ALL on first run).
  //   3. Push in batches so large catalogs don't time out or OOM.
  //   4. Advance the cursor to syncedAt so the next restart is cheap.
  // Run sync in the background — never block server startup.
  // With a large catalogue (250k+) a full sync can take 30-60s; blocking onReady
  // would hit Fastify's hook timeout and crash the server.
  fastify.addHook("onReady", async () => {
    setImmediate(() => {
      void (async () => {
        try {
          const syncedAt     = new Date();
          const cursorRaw    = await fastify.redis.get(SYNC_CURSOR_KEY);
          const lastSyncedAt = cursorRaw ? new Date(cursorRaw) : null;

          const medicines = await fastify.prisma.medicine.findMany({
            ...(lastSyncedAt ? { where: { updatedAt: { gt: lastSyncedAt } } } : {}),
            orderBy: { updatedAt: "asc" },
          });

          if (medicines.length === 0) {
            fastify.log.info("Meilisearch: index already up to date, nothing to sync");
            return;
          }

          for (let i = 0; i < medicines.length; i += SYNC_BATCH_SIZE) {
            await index.addDocuments(medicines.slice(i, i + SYNC_BATCH_SIZE));
          }

          await fastify.redis.set(SYNC_CURSOR_KEY, syncedAt.toISOString());

          fastify.log.info(
            `Meilisearch: synced ${medicines.length} medicine(s) ${lastSyncedAt ? `(delta since ${lastSyncedAt.toISOString()})` : "(full sync — first run)"}`,
          );
        } catch (err) {
          fastify.log.warn({ err }, "Meilisearch sync failed — search may be stale");
        }
      })();
    });
  });
};

export default fp(meilisearchPlugin, { name: "meilisearch" });
