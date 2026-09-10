package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/** PATCH /medicines/{id} — PLATFORM_ADMIN only; edits the shared catalog entry. */
public record UpdateMedicineRequest(
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
        // "I checked a physical pack" — see CreateMedicineRequest#packSizeConfirmed. Absent or
        // false leaves the pack size UNVERIFIED, which is what an unaccompanied edit deserves:
        // changing the number in a form is not the same as having looked at the carton.
        Boolean packSizeConfirmed
) {
    /** Back-compat for callers that predate loose-dispensing packaging. */
    public UpdateMedicineRequest(String name, String genericName, String manufacturer, String composition,
                                 String category, String schedule, String hsnCode, BigDecimal gstRate,
                                 String form, String strength, String unit, String packSize) {
        this(name, genericName, manufacturer, composition, category, schedule, hsnCode, gstRate,
                form, strength, unit, packSize, null, null, null);
    }

    /** Back-compat for callers that predate pack-size confidence. */
    public UpdateMedicineRequest(String name, String genericName, String manufacturer, String composition,
                                 String category, String schedule, String hsnCode, BigDecimal gstRate,
                                 String form, String strength, String unit, String packSize,
                                 Integer unitsPerPack, String baseUnit) {
        this(name, genericName, manufacturer, composition, category, schedule, hsnCode, gstRate,
                form, strength, unit, packSize, unitsPerPack, baseUnit, null);
    }
}
