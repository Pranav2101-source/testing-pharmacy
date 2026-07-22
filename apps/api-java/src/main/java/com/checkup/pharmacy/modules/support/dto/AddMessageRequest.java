package com.checkup.pharmacy.modules.support.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AddMessageRequest(@NotBlank(message = "Message required") @Size(max = 5000) String message) {
}
