import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  console.log(`API running at http://${env.API_HOST}:${env.API_PORT}`);
  if (env.NODE_ENV !== "production") {
    console.log(`Swagger docs: http://localhost:${env.API_PORT}/docs`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
