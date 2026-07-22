package com.checkup.pharmacy.tenant;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a method that legitimately operates outside a single tenant, exempting it
 * from Row-Level Security for the duration of the call.
 *
 * <p>Use this only where the tenant genuinely cannot be known yet — authentication
 * looking a user up by email, a scheduled job sweeping every pharmacy — or where
 * crossing tenants is the entire point and is already guarded by role-based
 * access control, as on the platform-admin routes.
 *
 * <p><b>Why an annotation rather than a {@link SystemContext} call inside the
 * method.</b> Elevation must be in place <i>before</i> the transaction begins,
 * because {@link RlsTenantTransactionManager} stamps the tenant GUC in
 * {@code doBegin}. A {@code SystemContext.callAsSystem(...)} block in the body of
 * an already-{@code @Transactional} method runs too late — the transaction has
 * already been scoped to "no tenant" and the elevation has no effect. Its aspect
 * is ordered ahead of the transaction interceptor precisely to close that gap.
 *
 * <p>Every use of this annotation widens database access. Treat adding one as a
 * security-relevant change and justify it in review.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CrossTenant {

    /** Why this method needs cross-tenant access. Required — it is the review trail. */
    String value();
}
