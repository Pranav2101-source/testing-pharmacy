package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Turn loose selling on for several medicines at once, each with its own pack size. */
public record BulkEnableLooseRequest(
        @NotEmpty @Size(max = 200) @Valid List<Row> items
) {
    public record Row(
            @NotBlank String medicineId,
            @Min(value = 2, message = "A pack must have at least 2 units")
            @Max(value = 100000, message = "Units per pack looks too large")
            Integer unitsPerPack,
            Boolean looseByDefault
    ) {
    }
}
