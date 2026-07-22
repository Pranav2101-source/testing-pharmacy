package com.checkup.pharmacy.modules.platform.tenant;

import com.checkup.pharmacy.common.exception.BadRequestException;

import java.util.Map;
import java.util.Set;

/**
 * Subscription plan catalogue — price per billing cycle, in rupees. Ported
 * verbatim from the Node {@code pharmacy.constants.ts} ({@code PLAN_PRICING} +
 * {@code DEFAULT_SUBSCRIPTION}). An unknown plan resolves to 0 (treated as Free),
 * matching the original's {@code pricing ? ... : DEFAULT_SUBSCRIPTION.amount}.
 */
public final class PlanPricing {

    public static final String DEFAULT_PLAN = "Free";
    public static final String DEFAULT_BILLING_CYCLE = "MONTHLY";

    private record Price(double monthly, double quarterly, double yearly) {
    }

    private static final Map<String, Price> PLANS = Map.of(
            "Free", new Price(0, 0, 0),
            "Standard", new Price(999, 2697, 9590),
            "Professional", new Price(2499, 6747, 23990),
            "Enterprise", new Price(4999, 13497, 47990));

    /** The only accepted plan names, and billing cycles — anything else is a client error. */
    public static final Set<String> PLAN_NAMES = PLANS.keySet();
    public static final Set<String> BILLING_CYCLES = Set.of("MONTHLY", "QUARTERLY", "YEARLY");

    private PlanPricing() {
    }

    /**
     * Validates a plan name, throwing a clear 400 rather than silently pricing an
     * unknown plan at 0 (the old {@link #amountFor} fallback). Call at every write
     * entry point that accepts a client-supplied plan (tenant create, change-plan).
     */
    public static void requireValidPlan(String planName) {
        if (planName == null || !PLAN_NAMES.contains(planName)) {
            throw new BadRequestException("Unknown plan '" + planName + "'. Allowed plans: "
                    + String.join(", ", "Free", "Standard", "Professional", "Enterprise"));
        }
    }

    /** Validates a billing cycle (nullable = "use the existing/default cycle" at the call site). */
    public static void requireValidBillingCycle(String billingCycle) {
        if (billingCycle != null && !BILLING_CYCLES.contains(billingCycle)) {
            throw new BadRequestException("Unknown billing cycle '" + billingCycle
                    + "'. Allowed cycles: MONTHLY, QUARTERLY, YEARLY");
        }
    }

    /** Price for a plan on a billing cycle; 0 for an unknown plan (Free-equivalent). */
    public static double amountFor(String planName, String billingCycle) {
        Price p = PLANS.get(planName);
        if (p == null) {
            return 0;
        }
        return switch (billingCycle == null ? DEFAULT_BILLING_CYCLE : billingCycle.toUpperCase()) {
            case "YEARLY" -> p.yearly();
            case "QUARTERLY" -> p.quarterly();
            default -> p.monthly();
        };
    }
}
