package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.common.enums.TicketStatus;
import jakarta.validation.constraints.NotNull;

public record UpdateStatusRequest(@NotNull(message = "Status required") TicketStatus status) {
}
