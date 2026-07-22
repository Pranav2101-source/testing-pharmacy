package com.checkup.pharmacy.modules.calendar.dto;

import com.checkup.pharmacy.common.enums.CalendarEventType;

import java.time.Instant;

/** Unified shape for both manual (DB-stored) and auto-derived (expiry/credit/PO) events. */
public record CalendarEventResponse(
        String id,
        String title,
        String description,
        Instant date,
        Instant endDate,
        boolean allDay,
        CalendarEventType type,
        String color,
        String relatedId,
        String relatedType,
        boolean isDone,
        boolean isAutomatic,
        Instant createdAt
) {
}
