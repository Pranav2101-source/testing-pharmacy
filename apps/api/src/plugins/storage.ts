import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient;
  }
}

const storagePlugin: FastifyPluginAsync = async (fastify) => {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });

  fastify.decorate("supabase", client);

  fastify.log.info("[supabase] storage client initialised");
};

export default fp(storagePlugin, { name: "supabase-storage" });
