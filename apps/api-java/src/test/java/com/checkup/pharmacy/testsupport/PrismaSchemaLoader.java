package com.checkup.pharmacy.testsupport;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * Builds the application schema inside a throwaway Postgres by replaying the real
 * Prisma migration SQL.
 *
 * <p>WHY NOT hibernate ddl-auto, AND WHY NOT H2
 * <p>Prisma owns this schema in every environment (see the project README), so a
 * schema generated from the JPA entities would be a *different* schema that merely
 * resembles production — the exact mismatch integration tests exist to catch. And
 * H2, even in PostgreSQL mode, does not implement the features these migrations use
 * (enum types, partial/expression indexes, RLS policies, dollar-quoted functions).
 * Replaying the genuine migration files is the only way for an assertion here to
 * mean anything about production.
 *
 * <p>WHY NOT {@code prisma migrate deploy}
 * <p>That would make the Java test suite depend on Node, pnpm, and an installed
 * Prisma CLI. Reading the .sql files needs none of that, and the files are the same
 * artifact the CLI would apply.
 *
 * <p>ON MULTI-STATEMENT EXECUTION
 * <p>Each file is handed to the driver whole rather than split on semicolons.
 * Splitting is what usually breaks here: these migrations contain dollar-quoted
 * function bodies ({@code $$ ... ; ... $$}) whose internal semicolons are not
 * statement terminators, and any naive splitter shreds them. The PostgreSQL driver
 * sends a multi-statement string using the simple query protocol and lets the
 * *server* parse it, which gets dollar-quoting right by construction. It also wraps
 * the file in one implicit transaction, so a half-applied migration cannot happen.
 */
public final class PrismaSchemaLoader {

    private static final String MIGRATIONS_DIR = "packages/database/prisma/migrations";
    private static final String APP_USER_INIT = "infra/docker/postgres-init/01-app-user.sql";

    private PrismaSchemaLoader() {
    }

    /**
     * Creates the {@code app_user} role, then replays every migration in filename
     * order — the same order {@code prisma migrate deploy} uses, and the order the
     * migrations depend on (later ones ALTER tables earlier ones CREATE).
     */
    public static void apply(Connection connection) {
        Path repoRoot = locateRepoRoot();

        // Must precede the migrations: 20260618000005_prescriptions GRANTs to
        // app_user, and a GRANT to a role that does not exist is a hard error.
        applyAppUserBootstrap(connection, repoRoot);

        List<Path> migrations = listMigrations(repoRoot.resolve(MIGRATIONS_DIR));
        if (migrations.isEmpty()) {
            throw new IllegalStateException(
                    "No Prisma migrations found under " + repoRoot.resolve(MIGRATIONS_DIR)
                            + ". Integration tests would then run against an empty schema and "
                            + "pass vacuously, so this fails loudly instead.");
        }

        for (Path migration : migrations) {
            // The directory name is the useful identifier; the file is always migration.sql.
            String name = migration.getParent().getFileName().toString();
            execute(connection, read(migration), name);
        }
    }

    /**
     * Applies the compose init script that creates {@code app_user} and its default
     * privileges.
     *
     * <p>The script is written for a first-boot container and is not idempotent: its
     * {@code CREATE ROLE} fails if the role is already there. Roles are cluster-global
     * while the database is recreated per run, so on every run after the first the
     * role DOES already exist — and because the driver executes the file as one
     * implicit transaction, that single failure would roll back the GRANTs and
     * ALTER DEFAULT PRIVILEGES too, which ARE per-database and genuinely needed.
     *
     * <p>So: create the role only when absent, and always apply the rest. The script
     * stays the single source of truth for what the role is granted.
     */
    private static void applyAppUserBootstrap(Connection connection, Path repoRoot) {
        String script = read(repoRoot.resolve(APP_USER_INIT));

        if (roleExists(connection, "app_user")) {
            // Drop just the CREATE ROLE statement. If the script is ever reworded this
            // no longer matches, the statement runs, and the duplicate-role error is
            // raised loudly rather than silently skipping the grants.
            script = script.replace("CREATE ROLE app_user LOGIN PASSWORD 'app_pass';", "");
        }
        execute(connection, script, APP_USER_INIT);
    }

    private static boolean roleExists(Connection connection, String role) {
        String sql = "SELECT 1 FROM pg_roles WHERE rolname = '" + role + "'";
        try (Statement statement = connection.createStatement();
             java.sql.ResultSet rs = statement.executeQuery(sql)) {
            return rs.next();
        } catch (SQLException e) {
            throw new IllegalStateException("Could not check whether role " + role + " exists", e);
        }
    }

    private static List<Path> listMigrations(Path migrationsDir) {
        if (!Files.isDirectory(migrationsDir)) {
            throw new IllegalStateException("Migrations directory not found: " + migrationsDir);
        }
        try (Stream<Path> dirs = Files.list(migrationsDir)) {
            return dirs.filter(Files::isDirectory)
                    .map(dir -> dir.resolve("migration.sql"))
                    .filter(Files::isRegularFile)
                    // Prisma prefixes every directory with a sortable timestamp, so
                    // lexicographic order is chronological order.
                    .sorted(Comparator.comparing(p -> p.getParent().getFileName().toString()))
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException("Could not list migrations in " + migrationsDir, e);
        }
    }

    private static void execute(Connection connection, String sql, String label) {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (SQLException e) {
            // Without the migration name the failure is an anonymous SQL error in a
            // 60-file replay, which is close to undebuggable.
            throw new IllegalStateException(
                    "Failed applying migration '" + label + "': " + e.getMessage(), e);
        }
    }

    private static String read(Path file) {
        try {
            return Files.readString(file);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read " + file, e);
        }
    }

    /**
     * Walks up from the working directory looking for the migrations folder.
     *
     * <p>Surefire/Failsafe set the working directory to the Maven module
     * ({@code apps/api-java}), but IDEs frequently set it to the repo root instead.
     * Hardcoding {@code ../../} works under Maven and breaks in the IDE, so search
     * upward and accept either.
     */
    private static Path locateRepoRoot() {
        Path candidate = Path.of("").toAbsolutePath();
        while (candidate != null) {
            if (Files.isDirectory(candidate.resolve(MIGRATIONS_DIR))) {
                return candidate;
            }
            candidate = candidate.getParent();
        }
        throw new IllegalStateException(
                "Could not locate the repository root (no ancestor of "
                        + Path.of("").toAbsolutePath() + " contains " + MIGRATIONS_DIR + ")");
    }
}
