package com.checkup.pharmacy.modules.integration.emr.dto;

import com.checkup.pharmacy.modules.medicine.MedicineMatcher;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record EmrMedicineMatchRequest(
        @NotEmpty @Size(max = 100) @Valid List<Item> items
) {
    public record Item(
            @NotBlank @Size(max = 100) String externalItemId,
            @Size(max = 100) String medicineId,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 200) String genericName,
            @Size(max = 100) String strength,
            @Size(max = 100) String form
    ) implements MedicineMatcher.MatchInput {
    }
}
