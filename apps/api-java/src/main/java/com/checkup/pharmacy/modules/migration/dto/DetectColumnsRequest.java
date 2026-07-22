package com.checkup.pharmacy.modules.migration.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

public record DetectColumnsRequest(@NotEmpty @Size(max = 100) List<@Size(max = 100) String> headers) {
}
