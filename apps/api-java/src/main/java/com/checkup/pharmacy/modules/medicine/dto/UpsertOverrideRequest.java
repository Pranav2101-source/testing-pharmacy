package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.math.BigDecimal;

public record UpsertOverrideRequest(
        BigDecimal gstRate,
        @DecimalMin(value = "0", message = "Discount must be between 0 and 100")
        @DecimalMax(value = "100", message = "Discount must be between 0 and 100")
        BigDecimal defaultDiscountPct,
        String notes,
        /**
         * Turn cut-strip (loose) selling on/off for this medicine at this pharmacy.
         * Null = leave unchanged. Enabling it requires an effective pack size &gt; 1
         * (the catalogue's, or {@code unitsPerPack} below).
         */
        Boolean allowLooseSale,
        /**
         * This pharmacy's pack size for the medicine, used when the shared catalogue
         * has none or the wrong one. Null = use the catalogue value.
         */
        @Min(value = 2, message = "Units per pack must be at least 2 to sell loose")
        @Max(value = 100000, message = "Units per pack looks too large — check the value")
        Integer unitsPerPack,
        /** New POS lines for this medicine start as loose. Null = leave unchanged. */
        Boolean looseByDefault,
        /** True once the pack size has been checked against a real strip. */
        Boolean confirmed
) {
    /** Back-compat for the GST/discount-only callers that predate loose settings. */
    public UpsertOverrideRequest(BigDecimal gstRate, BigDecimal defaultDiscountPct, String notes) {
        this(gstRate, defaultDiscountPct, notes, null, null, null, null);
    }

    /** Back-compat for the loose-toggle callers that predate the default / confirm fields. */
    public UpsertOverrideRequest(BigDecimal gstRate, BigDecimal defaultDiscountPct, String notes,
                                 Boolean allowLooseSale, Integer unitsPerPack) {
        this(gstRate, defaultDiscountPct, notes, allowLooseSale, unitsPerPack, null, null);
    }

    /** Whether this request carries anything at all — an empty override is rejected. */
    public boolean isEmpty() {
        return gstRate == null && defaultDiscountPct == null
                && (notes == null || notes.isBlank())
                && allowLooseSale == null && unitsPerPack == null
                && looseByDefault == null && confirmed == null;
    }
}
