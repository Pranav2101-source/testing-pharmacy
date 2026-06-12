import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient;
  }
}

const storagePlugin: FastifyPluginAsync = async (fastify) => {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  fastify.decorate("supabase", client);

  fastify.log.info("[supabase] storage client initialised");
};

export default fp(storagePlugin, { name: "supabase-storage" });
