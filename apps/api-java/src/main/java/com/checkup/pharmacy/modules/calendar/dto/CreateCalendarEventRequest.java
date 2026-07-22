package com.checkup.pharmacy.modules.calendar.dto;

import com.checkup.pharmacy.common.enums.CalendarEventType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record CreateCalendarEventRequest(
        @NotBlank(message = "Title required") @Size(max = 200) String title,
        @Size(max = 500) String description,
        @NotNull(message = "Invalid date") Instant date,
        Instant endDate,
        Boolean allDay,
        CalendarEventType type,
        @Size(max = 20) String color,
        String relatedId,
        String relatedType
) {
}
