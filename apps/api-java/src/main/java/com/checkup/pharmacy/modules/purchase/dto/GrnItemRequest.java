package com.checkup.pharmacy.modules.purchase.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A line's medicine is resolved exactly one of three ways: {@code medicineId} (an
 * existing global catalogue medicine), {@code localMedicineId} (an existing
 * pharmacy-local medicine, picked from this pharmacy's own prior local list), or
 * neither — meaning "resolve or create a pharmacy-local medicine from the
 * name/manufacturer/etc. supplied on this line", so the GRN is never blocked on the
 * global catalogue. {@code manufacturer}/{@code genericName}/{@code strength}/
 * {@code form}/{@code unit}/{@code hsnCode}/{@code schedule} are read only in that
 * third case (a first receipt of a genuinely new local medicine); they are ignored
 * once a medicine — global or local — is already identified.
 */
public record GrnItemRequest(
        String medicineId,
        String localMedicineId,
        @NotBlank String medicineName,
        String manufacturer,
        String genericName,
        String strength,
        String form,
        String unit,
        String hsnCode,
        String schedule,
        @NotBlank @Size(max = 50) String batchNumber,
        @NotNull Instant expiryDate,
        @PositiveOrZero Integer orderedQty,
        @NotNull @Positive Integer receivedQty,
        @PositiveOrZero Integer freeQty,
        String purchaseUnit,
        @Positive Integer conversionFactor,
        @NotNull @Positive BigDecimal purchaseRate,
        @NotNull @Positive BigDecimal mrp,
        @Min(0) BigDecimal discount,
        @NotNull BigDecimal gstRate
) {
    @AssertTrue(message = "MRP must be greater than or equal to purchase rate")
    public boolean isMrpAboveRate() {
        return mrp == null || purchaseRate == null || mrp.compareTo(purchaseRate) >= 0;
    }

    @AssertTrue(message = "A line may name at most one of medicineId/localMedicineId, not both")
    public boolean isSingleMedicineReference() {
        return medicineId == null || medicineId.isBlank() || localMedicineId == null || localMedicineId.isBlank();
    }

    public int freeQtyOrZero() {
        return freeQty == null ? 0 : freeQty;
    }

    public String purchaseUnitOrDefault() {
        return (purchaseUnit == null || purchaseUnit.isBlank()) ? "UNIT" : purchaseUnit;
    }

    public int conversionFactorOrDefault() {
        return conversionFactor == null ? 1 : conversionFactor;
    }

    public BigDecimal discountOrZero() {
        return discount == null ? BigDecimal.ZERO : discount;
    }
}
