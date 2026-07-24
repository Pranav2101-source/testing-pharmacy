package com.checkup.pharmacy.modules.platform.analytics;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.modules.platform.analytics.dto.ActivityListResponse;
import com.checkup.pharmacy.modules.platform.analytics.dto.AnalyticsDashboardResponse;
import com.checkup.pharmacy.modules.platform.analytics.dto.NewPharmaciesResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;

/** Platform analytics dashboard + drilldowns + exports. Platform-admin only. */
@RestController
@RequestMapping("/api/v1/platform/analytics")
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
public class AnalyticsController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final long DAY_MS = 86_400_000L;

    /** Cache-key granularity for the dashboard range — matches the 5-minute cache TTL. */
    private static final long CACHE_BUCKET_SECONDS = 300L;

    private final AnalyticsService analyticsService;

    public AnalyticsController(AnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    @GetMapping("/dashboard")
    public ApiResponse<AnalyticsDashboardResponse> dashboard(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String refresh) {
        Instant toInstant = to != null ? parseFlexible(to, true) : Instant.now();
        Instant fromInstant = from != null ? parseFlexible(from, false)
                : toInstant.minusMillis(30 * DAY_MS);
        // An inverted range matches nothing, and every widget would render a confident
        // zero — which reads as "the platform did nothing this period" rather than
        // "your dates are backwards". Say so instead.
        requireOrderedRange(fromInstant, toInstant);

        // Snap to a stable bucket BEFORE hitting the service. The page asks for a window
        // ending "now", so the raw range carries millisecond precision and every load
        // produced a unique cache key — a measured 100% miss rate (~5-6s per load) against
        // ~0.3s once the key repeats. Snapping the computed range (not just the key) keeps
        // the cached numbers matching the window they were computed for; the cost is up to
        // one bucket of extra staleness, which the TTL already accepts.
        Instant fromSnapped = snapToCacheBucket(fromInstant);
        Instant toSnapped = snapToCacheBucket(toInstant);
        return ApiResponse.ok(analyticsService.getDashboard(fromSnapped, toSnapped, "true".equals(refresh)));
    }

    @GetMapping("/activity")
    public ApiResponse<ActivityListResponse> activity() {
        return ApiResponse.ok(analyticsService.getActivity());
    }

    @GetMapping("/new-pharmacies")
    public ApiResponse<NewPharmaciesResponse> newPharmacies(
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String plan,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String sort) {
        int d = clamp(days, 1, 365);
        int p = Math.max(page, 1);
        int l = clamp(limit, 1, 50);
        return ApiResponse.ok(analyticsService.getNewPharmacies(d, p, l, search, plan, status, sort));
    }

    @GetMapping("/new-pharmacies/export")
    public ResponseEntity<byte[]> newPharmaciesExport(
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String plan,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String sort) {
        int d = clamp(days, 1, 365);
        AnalyticsService.ExportPayload payload = analyticsService.exportNewPharmacies(d, search, plan, status, sort);
        return download(payload);
    }

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String format,
            @RequestParam(required = false) String allTime) {
        String fmt = "xlsx".equals(format) ? "xlsx" : "csv";

        // The frontend's "all time" toggle sends allTime=true (alongside from/to): export
        // across the whole dataset, not the picked range — so the button does what it says.
        if ("true".equals(allTime)) {
            Instant now = Instant.now();
            return download(analyticsService.exportDashboardData(Instant.EPOCH, now, fmt));
        }

        if (from == null || to == null) {
            throw new BadRequestException("Missing from and to dates");
        }
        Instant fromInstant;
        Instant toInstant;
        try {
            fromInstant = LocalDate.parse(from).atStartOfDay(IST).toInstant();
            toInstant = LocalDate.parse(to).plusDays(1).atStartOfDay(IST).toInstant().minusMillis(1);
        } catch (DateTimeParseException e) {
            throw new BadRequestException("Invalid date format");
        }
        // Order first: a backwards range yields a NEGATIVE span, which sails past the
        // one-year ceiling below and exports an empty file that looks like real output.
        requireOrderedRange(fromInstant, toInstant);
        double daysDiff = (toInstant.toEpochMilli() - fromInstant.toEpochMilli()) / (double) DAY_MS;
        if (daysDiff > 366) {
            throw new BadRequestException("Export range cannot exceed 1 year — narrow the dates and try again.");
        }
        return download(analyticsService.exportDashboardData(fromInstant, toInstant, fmt));
    }

    private static ResponseEntity<byte[]> download(AnalyticsService.ExportPayload payload) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + payload.filename() + "\"")
                .contentType(MediaType.parseMediaType(payload.contentType()))
                .body(payload.content());
    }

    /** Accepts either a full ISO instant or a plain yyyy-MM-dd; the latter anchors to IST day bounds. */
    private static Instant parseFlexible(String value, boolean endOfDay) {
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ignored) {
            try {
                LocalDate d = LocalDate.parse(value);
                return endOfDay ? d.plusDays(1).atStartOfDay(IST).toInstant().minusMillis(1)
                        : d.atStartOfDay(IST).toInstant();
            } catch (DateTimeParseException e) {
                throw new BadRequestException("Invalid date format");
            }
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    /**
     * Rounds an instant down to a {@link #CACHE_BUCKET_SECONDS} boundary so that repeated
     * dashboard loads share one cache entry instead of each minting a unique key.
     * Aligned to the cache TTL: at most one full recompute per bucket.
     */
    private static Instant snapToCacheBucket(Instant t) {
        long secs = t.getEpochSecond();
        return Instant.ofEpochSecond(secs - Math.floorMod(secs, CACHE_BUCKET_SECONDS));
    }

    /** Rejects a backwards date range, naming both ends so the mistake is obvious. */
    private static void requireOrderedRange(Instant from, Instant to) {
        if (from.isAfter(to)) {
            throw new BadRequestException("The start date (" + LocalDate.ofInstant(from, IST)
                    + ") is after the end date (" + LocalDate.ofInstant(to, IST)
                    + ") — check the range and try again.");
        }
    }
}
