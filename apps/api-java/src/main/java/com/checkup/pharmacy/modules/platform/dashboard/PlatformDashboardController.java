package com.checkup.pharmacy.modules.platform.dashboard;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.platform.dashboard.dto.PlatformStatsResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/** Platform-admin home dashboard — stats + CSV export. Platform-admin only. */
@RestController
@RequestMapping("/api/v1/platform")
public class PlatformDashboardController {

    private final PlatformDashboardService dashboardService;

    public PlatformDashboardController(PlatformDashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/stats")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<PlatformStatsResponse> stats() {
        return ApiResponse.ok(dashboardService.getStats());
    }

    @GetMapping("/export")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ResponseEntity<byte[]> export() {
        String csv = dashboardService.exportReportCsv();
        String filename = "platform-report-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }
}
