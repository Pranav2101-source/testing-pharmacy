package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * Turns cut-strip (loose) selling on or off for one medicine at the caller's
 * pharmacy, and optionally records this pharmacy's pack size for it.
 */
public record LoosePosSettingsRequest(
        @NotNull(message = "Say whether loose selling is on or off") Boolean allowLooseSale,
        @Min(value = 2, message = "A pack must have at least 2 units to sell loose")
        @Max(value = 100000, message = "Units per pack looks too large — check the value")
        Integer unitsPerPack,
        /** New bill lines for this medicine start as loose. Null = leave as it was. */
        Boolean looseByDefault,
        /** True once the pharmacist has checked the pack size against a real strip. */
        Boolean confirmed
) {
    /** Back-compat for the two-field callers. */
    public LoosePosSettingsRequest(Boolean allowLooseSale, Integer unitsPerPack) {
        this(allowLooseSale, unitsPerPack, null, null);
    }
}
