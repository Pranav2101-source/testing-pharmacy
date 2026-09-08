package com.checkup.pharmacy.common.tax;

import com.checkup.pharmacy.common.exception.BadRequestException;

import java.math.BigDecimal;
import java.util.Set;

/**
 * The GST slabs a medicine can be sold under in India — shared by the global
 * catalogue ({@code Medicine}) and pharmacy-local medicines ({@code PharmacyMedicine})
 * so neither can be saved with a rate that doesn't correspond to a real slab. A local
 * medicine used to accept any non-null value here (only {@code @NotNull}, no slab
 * check), which the catalogue has enforced since day one.
 */
public final class GstRates {

    public static final Set<BigDecimal> ALLOWED =
            Set.of(BigDecimal.ZERO, BigDecimal.valueOf(5), BigDecimal.valueOf(12), BigDecimal.valueOf(18));

    private GstRates() {
    }

    public static boolean isAllowed(BigDecimal rate) {
        return rate != null && ALLOWED.stream().anyMatch(a -> a.compareTo(rate) == 0);
    }

    /** Throws if {@code rate} isn't one of the allowed slabs — {@code null} is rejected too. */
    public static void requireAllowed(BigDecimal rate) {
        if (!isAllowed(rate)) {
            throw new BadRequestException("gstRate must be 0, 5, 12, or 18");
        }
    }
}
