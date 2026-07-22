package com.checkup.pharmacy.modules.calendar;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.calendar.dto.CalendarEventResponse;
import com.checkup.pharmacy.modules.calendar.dto.CreateCalendarEventRequest;
import com.checkup.pharmacy.modules.calendar.dto.TodayCountResponse;
import com.checkup.pharmacy.modules.calendar.dto.UpdateCalendarEventRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/** Manual reminders + auto-derived events (expiry/credit/PO) — tenant-scoped, any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/calendar")
public class CalendarController {

    private final CalendarService calendarService;

    public CalendarController(CalendarService calendarService) {
        this.calendarService = calendarService;
    }

    @GetMapping("/events")
    public ApiResponse<List<CalendarEventResponse>> getEvents(
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to) {
        return ApiResponse.ok(calendarService.getEvents(from, to));
    }

    @GetMapping("/today-count")
    public ApiResponse<TodayCountResponse> todayCount() {
        return ApiResponse.ok(calendarService.getTodayCount());
    }

    @PostMapping("/events")
    public ResponseEntity<ApiResponse<CalendarEventResponse>> createEvent(
            @Valid @RequestBody CreateCalendarEventRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(calendarService.createEvent(req)));
    }

    @PatchMapping("/events/{id}")
    public ApiResponse<CalendarEventResponse> updateEvent(@PathVariable String id,
                                                          @Valid @RequestBody UpdateCalendarEventRequest req) {
        return ApiResponse.ok(calendarService.updateEvent(id, req));
    }

    @DeleteMapping("/events/{id}")
    public ApiResponse<Void> deleteEvent(@PathVariable String id) {
        calendarService.deleteEvent(id);
        return ApiResponse.ok(null);
    }
}
