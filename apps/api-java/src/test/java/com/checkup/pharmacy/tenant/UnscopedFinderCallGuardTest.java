package com.checkup.pharmacy.tenant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.fail;

/**
 * Fails the build when a service calls an INHERITED, unscoped Spring Data finder
 * ({@code findById} / {@code findAllById}) on a repository whose entity is
 * tenant-owned.
 *
 * <p><b>Why this exists.</b> {@link TenantIsolationGuardTest} checks methods
 * <i>declared</i> on repository interfaces, and says so explicitly in its javadoc:
 * inherited JpaRepository methods are out of scope, on the reasoning that Row-Level
 * Security closes that gap at runtime. That reasoning is sound but currently
 * inoperative — {@code app.rls.enabled} defaults to false, so nothing is closing it.
 *
 * <p>Five write paths were found relying on nothing but provenance: cancelling an
 * invoice, creating a sales return, releasing reservations, rolling up a purchase
 * order, and approving a stock audit. None leaked, because in every case the ids
 * came from rows that had themselves been fetched tenant-scoped. That is an argument
 * about call sites, and it stops being true the first time someone refactors one.
 *
 * <p><b>What this checks.</b> For every {@code *Service.java} under {@code modules/}:
 * resolve each repository field to its entity, and flag a call to {@code findById} or
 * {@code findAllById} on any entity carrying a {@code pharmacyId}. Global catalogue
 * repositories (Medicine, and anything else without that column) are unaffected.
 *
 * <p><b>What it does NOT do.</b> It cannot tell a read from a write — a read-only
 * name lookup is flagged the same as a stock mutation. That is deliberate: the
 * allowlist below forces the distinction to be stated once, in writing, instead of
 * being re-derived by whoever next reads the code.
 */
@DisplayName("Tenant isolation: services must not call unscoped finders on tenant-owned repositories")
class UnscopedFinderCallGuardTest {

    private static final String TENANT_COLUMN = "pharmacyId";

    /** {@code private final XxxRepository yyy;} */
    private static final Pattern FIELD =
            Pattern.compile("private\\s+final\\s+(\\w*Repository)\\s+(\\w+)\\s*;");

    /** {@code yyy.findById(} / {@code yyy.findAllById(} */
    private static final Pattern CALL =
            Pattern.compile("(\\w+)\\.(findById|findAllById)\\s*\\(");

    /**
     * Call sites that are intentionally unscoped, each with the reason it is safe.
     *
     * <p>Format: {@code Service.java:variable.method}. Adding an entry is a deliberate
     * act — a NEW unscoped call fails the build until someone writes down why it is
     * acceptable, which is the regression this guard exists to prevent.
     */
    private static final Set<String> JUSTIFIED = Set.of(
            // ── Read-only lookups that decorate a response.
            // Each resolves a display value (a user's name, a rack label, a linked
            // document's number) for a row that was ALREADY fetched tenant-scoped.
            // Nothing is written back, so the worst case is a label, not a mutation.
            "BillingService.java:userRepository.findById",
            "BillingService.java:userRepository.findAllById",
            "BillingService.java:invoiceRepository.findById",
            "BillingService.java:inventoryRepository.findById",
            "CashClosureService.java:userRepository.findById",
            "CashClosureService.java:userRepository.findAllById",
            "StockAuditService.java:userRepository.findById",
            "SupportService.java:userRepository.findById",
            "PurchasesService.java:purchaseOrderRepository.findById",
            "PrescriptionService.java:uploadRepository.findById",
            "SupplierCreditNoteService.java:supplierReturnRepository.findById",
            "SupplierPaymentService.java:grnRepository.findById",
            "InventoryService.java:shelfRepository.findAllById",
            "InventoryService.java:rackRepository.findAllById",
            "LocationService.java:rackRepository.findAllById",
            "LocationService.java:rackRepository.findById",
            "ReportsService.java:inventoryRepository.findAllById",

            // ── Authentication, which necessarily precedes tenant context.
            // AuthService resolves a user from a JWT subject or a login identifier —
            // there is no pharmacyId to scope BY until that lookup has succeeded. The
            // id is not user-supplied in the relevant sense: it comes from a signed
            // token this service itself issued.
            "AuthService.java:userRepository.findById",

            // ── Platform administration: cross-tenant BY DESIGN.
            // These are what a platform admin uses to manage every pharmacy, and are
            // gated by @PreAuthorize("hasRole('PLATFORM_ADMIN')") at the controller.
            "TenantService.java:pharmacyRepository.findById",
            "TenantService.java:pharmacyRepository.findAllById",
            "SubscriptionService.java:subscriptionRepository.findById",
            "PharmacyService.java:pharmacyRepository.findById",
            "SupportService.java:agentRepository.findById",

            // ── Tenancy enforced in Java immediately after the fetch, not in SQL.
            // Correct, just expressed differently — each of these filters on
            // getPharmacyId().equals(pharmacyId) before touching anything. Worth
            // knowing this style exists: it is why a call site being on this list is
            // not the same as it being unprotected.
            "SupplierReturnsService.java:inventoryRepository.findAllById",
            "MigrationService.java:supplierRepository.findAllById",
            "MigrationService.java:customerRepository.findAllById",
            "MigrationService.java:doctorRepository.findAllById",
            "MigrationService.java:inventoryRepository.findAllById"
    );

    @Test
    @DisplayName("no unreviewed unscoped finder calls on tenant-owned repositories")
    void noUnscopedFinderCallsOnTenantOwnedRepositories() {
        Path serviceRoot = locate("src/main/java/com/checkup/pharmacy/modules");
        Map<String, Class<?>> entityByRepository = mapRepositoriesToEntities();

        List<String> violations = new ArrayList<>();

        for (Path service : servicesUnder(serviceRoot)) {
            String source = read(service);
            String fileName = service.getFileName().toString();

            Map<String, String> repositoryByVariable = new HashMap<>();
            Matcher fields = FIELD.matcher(source);
            while (fields.find()) {
                repositoryByVariable.put(fields.group(2), fields.group(1));
            }

            Matcher calls = CALL.matcher(source);
            while (calls.find()) {
                String variable = calls.group(1);
                String method = calls.group(2);
                String repository = repositoryByVariable.get(variable);
                if (repository == null) {
                    continue; // not a repository field (e.g. a local map)
                }
                Class<?> entity = entityByRepository.get(repository);
                if (entity == null || !isTenantOwned(entity)) {
                    continue; // global catalogue, or a repository we could not resolve
                }
                String key = fileName + ":" + variable + "." + method;
                if (!JUSTIFIED.contains(key)) {
                    violations.add(key + "  (entity " + entity.getSimpleName() + " is tenant-owned)");
                }
            }
        }

        if (!violations.isEmpty()) {
            fail("""
                    Unscoped finder call(s) on tenant-owned repositories:

                    %s

                    findById/findAllById carry no pharmacyId predicate, so tenancy rests
                    entirely on where the ids came from. Prefer a scoped finder — e.g.
                    findByIdInAndPharmacyId, or lockAllByIdInAndPharmacyId when the read
                    is followed by a write that must not race.

                    If the call really is safe, add it to JUSTIFIED with the reason.
                    """.formatted(String.join("\n", violations.stream().map(v -> "  - " + v).toList())));
        }
    }

    /** Maps {@code XxxRepository} to the entity in its {@code JpaRepository<E, ID>}. */
    private static Map<String, Class<?>> mapRepositoriesToEntities() {
        var reflections = new org.reflections.Reflections("com.checkup.pharmacy");
        Map<String, Class<?>> byName = new HashMap<>();
        for (Class<?> repository : reflections.getSubTypesOf(org.springframework.data.repository.Repository.class)) {
            for (var type : repository.getGenericInterfaces()) {
                if (type instanceof java.lang.reflect.ParameterizedType parameterized
                        && parameterized.getActualTypeArguments().length > 0
                        && parameterized.getActualTypeArguments()[0] instanceof Class<?> entity) {
                    byName.put(repository.getSimpleName(), entity);
                }
            }
        }
        return byName;
    }

    private static boolean isTenantOwned(Class<?> entity) {
        for (Class<?> c = entity; c != null && c != Object.class; c = c.getSuperclass()) {
            for (var field : c.getDeclaredFields()) {
                if (TENANT_COLUMN.equals(field.getName())) {
                    return true;
                }
            }
        }
        return false;
    }

    private static List<Path> servicesUnder(Path root) {
        try (Stream<Path> paths = Files.walk(root)) {
            return paths.filter(p -> p.getFileName().toString().endsWith("Service.java")).toList();
        } catch (IOException e) {
            throw new UncheckedIOException("Could not scan " + root, e);
        }
    }

    private static String read(Path file) {
        try {
            return Files.readString(file);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read " + file, e);
        }
    }

    /** Surefire runs from the module directory; IDEs often use the repo root. */
    private static Path locate(String relative) {
        Path candidate = Path.of("").toAbsolutePath();
        while (candidate != null) {
            Path direct = candidate.resolve(relative);
            if (Files.isDirectory(direct)) {
                return direct;
            }
            Path viaModule = candidate.resolve("apps/api-java").resolve(relative);
            if (Files.isDirectory(viaModule)) {
                return viaModule;
            }
            candidate = candidate.getParent();
        }
        throw new IllegalStateException("Could not locate " + relative);
    }
}
