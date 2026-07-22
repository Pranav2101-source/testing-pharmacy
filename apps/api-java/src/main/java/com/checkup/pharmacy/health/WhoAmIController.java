package com.checkup.pharmacy.health;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.security.UserPrincipal;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Authenticated smoke-test endpoint. Requires a valid access token and echoes
 * the resolved tenant/user, proving the whole auth + tenant foundation works
 * end-to-end before any real module is ported. Safe to delete later.
 */
@RestController
@RequestMapping("/api/v1/whoami")
public class WhoAmIController {

    @GetMapping
    public ApiResponse<Map<String, Object>> whoami() {
        UserPrincipal me = TenantContext.currentUser();
        return ApiResponse.ok(Map.of(
                "userId", me.userId(),
                "pharmacyId", me.pharmacyId(),
                "role", me.role().name(),
                "email", me.email()));
    }
}
