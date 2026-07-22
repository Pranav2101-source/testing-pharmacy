package com.checkup.pharmacy.tenant;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Applies {@link CrossTenant} by entering {@link SystemContext} around the
 * annotated method.
 *
 * <p>The ordering is the whole point. Spring's transaction interceptor runs at
 * {@link Ordered#LOWEST_PRECEDENCE} by default; this aspect runs at
 * {@link Ordered#HIGHEST_PRECEDENCE}, so it wraps <i>outside</i> the transaction
 * advice. That guarantees {@code SystemContext.isActive()} is already true when
 * {@link RlsTenantTransactionManager#doBegin} reads it to decide whether to set
 * {@code app.bypass_rls}. Reverse the order and the annotation becomes a silent
 * no-op — the transaction would already have been stamped "no tenant" before the
 * elevation was visible.
 */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CrossTenantAspect {

    /**
     * The pointcut names the annotation by fully-qualified type rather than binding
     * it to an advice parameter. The binding form
     * ({@code @Around("@annotation(crossTenant)")} with a {@code CrossTenant}
     * argument) fails at runtime here with "Required to bind 2 arguments, but only
     * bound 1 (JoinPointMatch was NOT bound in invocation)" once the advised bean
     * already carries another proxy — which every {@code @Transactional} service
     * does. Nothing in this advice needs the annotation's values anyway; the reason
     * string is documentation for humans.
     */
    @Around("@annotation(com.checkup.pharmacy.tenant.CrossTenant)")
    public Object elevate(ProceedingJoinPoint joinPoint) throws Throwable {
        // callAsSystemThrowing (not callAsSystem) because proceed() is declared
        // `throws Throwable`, which a plain Supplier cannot carry through.
        return SystemContext.callAsSystemThrowing(joinPoint::proceed);
    }
}
