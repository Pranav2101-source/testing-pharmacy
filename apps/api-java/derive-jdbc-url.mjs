// Spring wants JDBC_DATABASE_URL ("jdbc:postgresql://…"); managed platforms
// (Render, RDS, Fly) hand you a Prisma-style DATABASE_URL ("postgresql://…").
// The app's DatabaseUrlEnvironmentPostProcessor only derives one from the other
// when it can read a local .env file, which a container has not got — so do it
// here and print `export` lines for the entrypoint to eval.
const raw = process.env.DATABASE_URL;
if (!raw || process.env.JDBC_DATABASE_URL) process.exit(0);

const u = new URL(raw);
const port = u.port || "5432";
const params = new URLSearchParams(u.search);
// prefer: use TLS when the server offers it (Render external), fall back to
// plaintext when it does not (Render internal) — safe either way.
if (!params.has("sslmode")) params.set("sslmode", "prefer");
// Supabase's transaction pooler needs this; harmless elsewhere.
if (!params.has("prepareThreshold")) params.set("prepareThreshold", "0");
const qs = params.toString();

const jdbc = `jdbc:postgresql://${u.hostname}:${port}${u.pathname}${qs ? "?" + qs : ""}`;
const esc = (s) => s.replace(/'/g, `'\''`);
process.stdout.write(
  `export JDBC_DATABASE_URL='${esc(jdbc)}'\n` +
  `export DB_USER='${esc(decodeURIComponent(u.username))}'\n` +
  `export DB_PASSWORD='${esc(decodeURIComponent(u.password))}'\n`
);
