import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../../../.."); // workspace root

const CONTAINER  = "pharmacy-test-postgres";
const TEST_DB    = "postgresql://postgres:testpassword@localhost:5433/pharmacy_test";

async function waitForPostgres(maxMs = 30_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      execSync(`docker exec ${CONTAINER} pg_isready -U postgres`, { stdio: "ignore" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw new Error("[globalSetup] Postgres container did not become ready in 30 s");
}

export async function setup(): Promise<void> {
  // Clean up any leftover container from a previous crashed run
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });

  console.log("\n[globalSetup] Starting test Postgres on :5433 …");
  execSync(
    [
      "docker run -d",
      `--name ${CONTAINER}`,
      "-e POSTGRES_PASSWORD=testpassword",
      "-e POSTGRES_DB=pharmacy_test",
      "-e POSTGRES_USER=postgres",
      "-p 5433:5432",
      "--tmpfs /var/lib/postgresql/data", // in-memory — no disk I/O, disposable
      "postgres:16-alpine",
    ].join(" "),
    { stdio: "ignore" },
  );

  await waitForPostgres();

  // Create the app_user role that Supabase provides but plain Postgres doesn't.
  // Some migrations GRANT to this role — without it migrate deploy fails with 42704.
  // pg_isready returning true only means TCP is up; psql may still reject connections
  // for a brief moment after that. Retry the CREATE ROLE up to 10 times to be safe.
  let roleCreated = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", CONTAINER, "psql", "-U", "postgres", "-c", "DO $$ BEGIN CREATE ROLE app_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"],
      { stdio: "ignore" },
    );
    if (result.status === 0) { roleCreated = true; break; }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!roleCreated) throw new Error("[globalSetup] Failed to create app_user role after 10 attempts");

  console.log("[globalSetup] Postgres ready. Applying migrations …");

  execSync("pnpm --filter @pharmacy/database exec prisma migrate deploy", {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB,
      DIRECT_URL:   TEST_DB,
    },
    stdio: "inherit",
  });

  console.log("[globalSetup] Migrations applied. Tests starting.\n");
}

export async function teardown(): Promise<void> {
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  console.log("\n[globalSetup] Test Postgres container removed.");
}
