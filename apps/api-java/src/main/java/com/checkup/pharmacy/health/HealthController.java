package com.checkup.pharmacy.health;

import com.checkup.pharmacy.common.api.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

/**
 * Public liveness endpoint. Proves the app boots and the response envelope is
 * wired correctly end-to-end.
 */
@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

    @GetMapping
    public ApiResponse<Map<String, Object>> health() {
        return ApiResponse.ok(Map.of(
                "status", "ok",
                "service", "checkup-pharmacy-api-java",
                "time", Instant.now().toString()));
    }
}
