package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

public record CreateMedicineRequest(
        @NotBlank(message = "Medicine name is required") String name,
        String genericName,
        String manufacturer,
        String composition,
        String category,
        String schedule,
        String hsnCode,
        BigDecimal gstRate,
        String form,
        String strength,
        String unit,
        String packSize,
        // Loose-dispensing packaging — platform admin sets these on the shared catalogue.
        @Min(value = 1, message = "Units per pack must be at least 1")
        @Max(value = 100000, message = "Units per pack looks too large — check the value")
        Integer unitsPerPack,
        String baseUnit,
        // "I checked a physical pack" — the difference between a pack size that is merely on
        // record and one somebody has actually held. Absent or false means UNVERIFIED, which is
        // the honest default for a form field somebody typed a plausible number into. It cannot
        // launder a contradiction: a pack size matching the SKU's own strength is still refused
        // with this set. See PackSizeEvidence.assess.
        Boolean packSizeConfirmed
) {
    /** Back-compat for callers that predate loose-dispensing packaging. */
    public CreateMedicineRequest(String name, String genericName, String manufacturer, String composition,
                                 String category, String schedule, String hsnCode, BigDecimal gstRate,
                                 String form, String strength, String unit, String packSize) {
        this(name, genericName, manufacturer, composition, category, schedule, hsnCode, gstRate,
                form, strength, unit, packSize, null, null, null);
    }

    /** Back-compat for callers that predate pack-size confidence. */
    public CreateMedicineRequest(String name, String genericName, String manufacturer, String composition,
                                 String category, String schedule, String hsnCode, BigDecimal gstRate,
                                 String form, String strength, String unit, String packSize,
                                 Integer unitsPerPack, String baseUnit) {
        this(name, genericName, manufacturer, composition, category, schedule, hsnCode, gstRate,
                form, strength, unit, packSize, unitsPerPack, baseUnit, null);
    }
}
