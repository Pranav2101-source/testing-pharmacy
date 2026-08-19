package com.checkup.pharmacy.tenant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.reflections.Reflections;
import org.reflections.scanners.Scanners;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.fail;

/**
 * Fails the build when a repository method that reads a tenant-owned entity does
 * not scope itself to a pharmacy.
 *
 * <p><b>Why this exists.</b> Tenant isolation in this codebase was enforced purely
 * by convention — {@code TenantContext}'s javadoc instructs services to include
 * {@code pharmacyId} in every query, and nothing verified that they did. Across
 * forty-two tenant-owned tables and hundreds of query methods, "everyone
 * remembers, forever" is not a control. The failure mode is also the worst kind:
 * silent, invisible in testing with one tenant's data, and a reportable breach in
 * production.
 *
 * <p><b>What it checks.</b> Every method <i>declared</i> on a repository whose
 * entity has a {@code pharmacyId} field must either take a {@code pharmacyId}
 * parameter, name it in the derived query, reference it in {@code @Query} JPQL, or
 * appear in {@link #JUSTIFIED_EXCEPTIONS} with a stated reason.
 *
 * <p><b>What it does NOT check</b>, stated plainly so this is not mistaken for
 * full coverage: inherited {@code JpaRepository} methods
 * ({@code findById}, {@code findAll}, {@code deleteById} …). Those are declared by
 * Spring Data, not by this codebase, and a service calling {@code findById} with a
 * user-supplied id is exactly the gap that Row-Level Security closes at runtime
 * (migration {@code 20260719000001}). The two layers are complementary and neither
 * alone is sufficient: this one catches the mistake at CI, RLS catches it in
 * production.
 */
@DisplayName("Tenant isolation: repository methods must be pharmacy-scoped")
class TenantIsolationGuardTest {

    private static final String TENANT_COLUMN = "pharmacyId";
    private static final String BASE_PACKAGE = "com.checkup.pharmacy";

    /**
     * Methods that are intentionally not scoped by {@code pharmacyId}, grouped by
     * why. Every entry was reviewed against its call sites; none is a blanket
     * silencing of the check.
     *
     * <p>Adding to this list is a deliberate act: a NEW unscoped repository method
     * fails the build until someone writes down which category it falls into, and
     * that is the regression this test exists to prevent.
     */
    private static final Set<String> JUSTIFIED_EXCEPTIONS = Set.of(

            // ── 1. Identity: the tenant is the OUTPUT of the query, not an input ──
            // Email is globally unique (migration 20260710000001) and the pharmacy is
            // read FROM the row returned, so it cannot also be a filter on it.
            "UserRepository#findByEmail",
            "UserRepository#existsByEmail",
            // Password reset presents only a token hash — no tenant is known yet.
            "UserRepository#findByPasswordResetToken",
            // The auth filter's revocation check, which runs before the
            // SecurityContext (and therefore the tenant) exists. The id comes from
            // an already signature-verified JWT subject, and the projection returns
            // only isActive/tokenVersion — no tenant-owned data crosses this call.
            "UserRepository#findAuthStatusById",

            // ── 2. Child rows reached through a tenant-owned parent ──────────────
            // These filter on a foreign key (invoiceId, sessionId, ticketId, …) whose
            // parent was itself loaded tenant-scoped, so the scope is inherited rather
            // than absent. The weakness is that it is inherited by CONVENTION: change
            // a caller to load the parent unscoped and the child query silently
            // follows. Row-Level Security is what makes this structurally safe rather
            // than merely correct-today — see migration 20260719000001.
            "GRNItemRepository#deleteByGrnId",
            "GRNItemRepository#findByGrnId",
            "GRNItemRepository#findByGrnIdIn",
            "GoodsReceiptNoteRepository#findByPurchaseOrderId",
            "GoodsReceiptNoteRepository#findByPurchaseOrderIdAndStatus",
            "InventoryMovementRepository#findByInventoryIdInAndReferenceType",
            // Migration rollback guard. The inventoryIds come from this session's own
            // MigrationCreatedRecord rows, which were loaded tenant-scoped; these only ask
            // "is anything referencing them" and return a COUNT, never a row.
            "InventoryMovementRepository#countByInventoryIdInAndReferenceTypeNot",
            "InvoiceItemRepository#countByInventoryIdIn",
            "SalesReturnItemRepository#countByInventoryIdIn",
            "InvoiceItemRepository#countByInvoiceIdIn",
            "InvoiceItemRepository#findByInvoiceId",
            "InvoicePaymentRepository#findByInvoiceIdOrderByPaidAtAsc",
            "MigrationImportJobRepository#findBySessionIdOrderByCreatedAtAsc",
            "PrescriptionItemRepository#deleteByPrescriptionId",
            "PrescriptionItemRepository#findByPrescriptionId",
            "QuotationItemRepository#deleteByQuotationId",
            "QuotationItemRepository#findByQuotationId",
            "QuotationItemRepository#findByQuotationIdIn",
            "SalesReturnItemRepository#findByInvoiceId",
            "SalesReturnItemRepository#findByReturnId",
            "SalesReturnRepository#findByInvoiceId",
            "StockAuditItemRepository#countBySessionIdAndCountedQtyIsNull",
            "StockAuditItemRepository#countCountedBySessionIds",
            "StockAuditItemRepository#countTotalBySessionIds",
            "StockAuditItemRepository#countVarianceBySessionIds",
            "StockAuditItemRepository#findByIdAndSessionId",
            "StockAuditItemRepository#findByIdInAndSessionId",
            "StockAuditItemRepository#findBySessionIdOrderByCreatedAtAsc",
            "StockAuditItemRepository#findVarianceItems",
            "StockAuditItemRepository#sumVarianceValueBySessionIds",
            "SubscriptionInvoiceRepository#findBySubscriptionId",
            "SubscriptionInvoiceRepository#findBySubscriptionIdInOrderByCreatedAtDesc",
            "SubscriptionInvoiceRepository#findBySubscriptionIdOrderByCreatedAtDesc",
            "SubscriptionInvoiceRepository#sumOutstandingForSubscription",
            "TicketAttachmentRepository#findByMessageId",
            "TicketAttachmentRepository#findByTicketId",
            "TicketMessageRepository#findByTicketIdOrderByCreatedAtAsc",

            // ── 2b. The SHARED medicine catalogue: cross-tenant is the question ──
            // Medicine has no pharmacyId — every pharmacy shares the catalogue. Before a
            // migration rollback deactivates an entry it created, it has to ask whether
            // ANY other pharmacy is still stocking it; scoping that to the caller would
            // answer the wrong question and let one rollback disable another pharmacy's
            // medicine. Returns medicine ids only — no tenant-owned row crosses the call.
            "InventoryRepository#findMedicineIdsInUse",

            // ── 3. Platform-admin aggregates: cross-tenant BY DESIGN ─────────────
            // Reachable only from routes annotated @PreAuthorize("hasRole('PLATFORM_ADMIN')")
            // (verified on AuditController, and the /platform/* controllers). These
            // compute platform-wide totals, so scoping them to one pharmacy would make
            // them wrong, not safer.
            "AuditLogRepository#countFailed",
            "AuditLogRepository#countLoginEvents",
            "AuditLogRepository#countSecurityAlerts",
            "AuditLogRepository#countTotal",
            "AuditLogRepository#findByIdWithRelations",
            "AuditLogRepository#findForExport",
            "AuditLogRepository#search",
            "AuditLogRepository#timeline",
            "SubscriptionInvoiceRepository#countByStatus",
            "SubscriptionInvoiceRepository#findPaidTotalsSince",
            "SubscriptionInvoiceRepository#sumOutstanding",
            "SubscriptionInvoiceRepository#sumPaidTotalSince",
            "SubscriptionRepository#countByStatus",
            "SubscriptionRepository#countByStatusAndAutoRenewTrue",
            "SubscriptionRepository#countByStatusAndUpdatedAtGreaterThanEqual",
            "SubscriptionRepository#countByStatusAndValidUntilBetween",
            "SubscriptionRepository#countByValidUntilBetween",
            "SubscriptionRepository#findActiveAmountsAndCycles",
            "SubscriptionRepository#findActiveTrialAmountsAndCycles",
            "SubscriptionRepository#findByIdWithPharmacy",
            "SubscriptionRepository#planDistribution",
            "SubscriptionRepository#statusDistribution",
            "SupportTicketRepository#countByStatus",
            "SupportTicketRepository#countByStatusIn",
            "SupportTicketRepository#countByStatusInAndPriority",
            "SupportTicketRepository#findTop3ByOrderByCreatedAtDesc",
            // Take an explicit collection of pharmacy ids, so the caller still states
            // its scope even though the parameter is not literally named pharmacyId.
            "UserRepository#countByPharmacyIdIn",
            "UserRepository#findByPharmacyIdInAndRole",
            "UserRepository#bumpTokenVersionByPharmacyIds",


            // ── 5. Scheduled sweepers: no tenant exists to scope BY ──────────────
            // Reachable only from EmrDispenseCallbackRetryJob, which runs on a cron with
            // no request and therefore no SecurityContext or TenantContext. Its whole job
            // is to find work across every pharmacy at once: scoping it per tenant would
            // mean one query per pharmacy every two minutes, growing with signups rather
            // than with integrations. The rows it returns are used only to re-attempt a
            // delivery the pharmacy itself already queued, and each delivery re-reads its
            // own prescription scoped by the pharmacyId carried on the row.
            "PrescriptionRepository#findDispenseCallbackBacklog",

            // ── 4. Load-then-authorize ───────────────────────────────────────────
            // The query is unscoped but the service checks ownership on the loaded row
            // before returning it: SupportService#getTicket calls assertCanAccess, and
            // #getAttachmentBytes compares the ticket's pharmacyId to the caller's.
            // Valid, but the check lives one layer away from the query — if a future
            // caller forgets it, nothing here complains. RLS is the backstop.
            "SupportTicketRepository#findByIdWithRelations",
            "TicketAttachmentRepository#findByFileUrl"
    );

    @Test
    void everyTenantScopedRepositoryMethodIsScoped() {
        Reflections reflections = new Reflections(BASE_PACKAGE, Scanners.SubTypes);
        Set<Class<? extends Repository>> repositories = reflections.getSubTypesOf(Repository.class);

        List<String> violations = new ArrayList<>();

        for (Class<?> repository : repositories) {
            if (!repository.isInterface()) {
                continue;
            }
            Class<?> entity = entityTypeOf(repository);
            if (entity == null || !isTenantOwned(entity)) {
                continue;
            }
            // getDeclaredMethods, not getMethods: inherited Spring Data methods are
            // out of scope here (see the class javadoc).
            for (Method method : repository.getDeclaredMethods()) {
                if (method.isSynthetic() || method.isDefault()) {
                    continue;
                }
                String id = repository.getSimpleName() + "#" + method.getName();
                if (JUSTIFIED_EXCEPTIONS.contains(id)) {
                    continue;
                }
                if (!isPharmacyScoped(method)) {
                    violations.add("  %s  (entity: %s)".formatted(id, entity.getSimpleName()));
                }
            }
        }

        if (!violations.isEmpty()) {
            fail("""
                    %d repository method(s) read or write a tenant-owned entity without scoping to a pharmacy.

                    %s

                    Each one can return or modify another pharmacy's data if the caller passes an id it
                    does not own. Fix by adding a pharmacyId parameter (e.g. findByIdAndPharmacyId) or by
                    referencing pharmacyId in the @Query. If the method is genuinely cross-tenant, add it
                    to JUSTIFIED_EXCEPTIONS in this test WITH a reason.
                    """.formatted(violations.size(), String.join("\n", violations)));
        }
    }

    /** Resolves T from {@code SomeRepository extends JpaRepository<T, ID>}. */
    private Class<?> entityTypeOf(Class<?> repository) {
        for (Type type : repository.getGenericInterfaces()) {
            if (type instanceof ParameterizedType parameterized) {
                Type[] args = parameterized.getActualTypeArguments();
                if (args.length >= 1 && args[0] instanceof Class<?> entity) {
                    return entity;
                }
            }
        }
        return null;
    }

    /** Walks the hierarchy so entities inheriting from a mapped superclass are included. */
    private boolean isTenantOwned(Class<?> entity) {
        for (Class<?> c = entity; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field field : c.getDeclaredFields()) {
                if (TENANT_COLUMN.equals(field.getName())) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean isPharmacyScoped(Method method) {
        // 1. An explicit @Query naming the column.
        Query query = method.getAnnotation(Query.class);
        if (query != null && query.value().contains(TENANT_COLUMN)) {
            return true;
        }
        // 2. A derived query whose name includes the property (findByPharmacyId...).
        if (method.getName().toLowerCase().contains(TENANT_COLUMN.toLowerCase())) {
            return true;
        }
        // 3. A parameter carrying the tenant. Relies on -parameters, which
        //    spring-boot-starter-parent enables; without it names would be argN and
        //    this check would silently never match.
        for (var parameter : method.getParameters()) {
            if (TENANT_COLUMN.equalsIgnoreCase(parameter.getName())) {
                return true;
            }
        }
        return false;
    }
}
