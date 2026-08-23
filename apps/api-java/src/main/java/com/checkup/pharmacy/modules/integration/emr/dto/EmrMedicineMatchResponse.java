package com.checkup.pharmacy.modules.integration.emr.dto;

import java.math.BigDecimal;
import java.util.List;

public record EmrMedicineMatchResponse(List<Item> items) {
    /**
     * @param matchStrategy EXACT_ID | EXACT_NAME | GENERIC_STRENGTH_FORM | AMBIGUOUS_NAME |
     *                      AMBIGUOUS_GENERIC | UNMATCHED. The AMBIGUOUS_* values are additive
     *                      as of this field's introduction — an older caller that only checks
     *                      {@code medicineId == null} (rather than switching on this string)
     *                      sees no behaviour change at all, since {@code medicineId} is still
     *                      null for both UNMATCHED and AMBIGUOUS_*.
     * @param ambiguous     true when this line matched MORE THAN ONE active medicine by name
     *                      (or generic+strength+form) rather than none at all — two different
     *                      problems that otherwise both look like "not found". {@code false}
     *                      whenever {@code medicineId} is non-null, since a resolved match is
     *                      never ambiguous by definition.
     */
    public record Item(
            String externalItemId,
            String matchStrategy,
            String medicineId,
            String name,
            String genericName,
            String strength,
            String form,
            String unit,
            int availableQuantity,
            BigDecimal approximatePrice,
            boolean ambiguous
    ) {
    }
}
