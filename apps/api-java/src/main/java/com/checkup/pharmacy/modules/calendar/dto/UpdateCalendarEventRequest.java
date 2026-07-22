package com.checkup.pharmacy.modules.calendar.dto;

import jakarta.validation.constraints.Size;

import java.time.Instant;

public record UpdateCalendarEventRequest(
        @Size(max = 200) String title,
        @Size(max = 500) String description,
        Instant date,
        Instant endDate,
        Boolean allDay,
        Boolean isDone,
        @Size(max = 20) String color
) {
}
