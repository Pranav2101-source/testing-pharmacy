package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.auth.AuthService;
import com.checkup.pharmacy.modules.auth.dto.RegisterRequest;
import com.checkup.pharmacy.modules.staff.StaffService;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The auth filter's revocation read is now served from {@link AuthStatusCache} — one of
 * the highest-leverage changes for surviving ~500 concurrent users, because before this
 * <em>every</em> authenticated request did a {@code findAuthStatusById} against a small
 * connection pool.
 *
 * <p>This IT drives the real {@link JwtAuthenticationFilter} with a real Bearer token and
 * proves the two things that make the cache safe: repeated requests stop hitting the
 * database, and a logout / deactivation still takes effect immediately (the eviction hook
 * fires, so the next request re-reads and gets rejected).
 *
 * <p>Not {@code @Transactional} — same reason as {@code AuthIT}: registration writes an
 * audit row in its own transaction.
 */
@AutoConfigureMockMvc
class AuthStatusCacheIT extends AbstractPostgresIT {

    @Autowired private MockMvc mockMvc;
    @Autowired private AuthService authService;
    @Autowired private StaffService staffService;
    @Autowired private JwtService jwtService;
    @Autowired private UserRepository userRepository;
    @Autowired private AuthStatusCache authStatusCache;

    private static final String PASSWORD = "correct-horse-battery";

    private User register() {
        String email = "cache-" + UUID.randomUUID().toString().substring(0, 8) + "@test.local";
        var result = authService.register(new RegisterRequest(
                "Cache Pharmacy", "Owner", "9876543210", email, PASSWORD,
                null, null, null, null, null, null));
        return userRepository.findById(result.user().id()).orElseThrow();
    }

    private String bearer(User u) {
        return "Bearer " + jwtService.issueTokens(u).accessToken();
    }

    @Test
    @DisplayName("repeated authenticated requests are served from the cache — the DB is read once")
    void repeatedRequestsHitTheCacheNotTheDatabase() throws Exception {
        User user = register();
        String token = bearer(user);
        authStatusCache.invalidate(user.getId());
        long hitsBefore = authStatusCache.stats().hitCount();
        long missesBefore = authStatusCache.stats().missCount();

        for (int i = 0; i < 4; i++) {
            mockMvc.perform(get("/api/v1/auth/me").header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isOk());
        }

        assertThat(authStatusCache.stats().missCount() - missesBefore)
                .as("exactly one database read for four requests").isEqualTo(1);
        assertThat(authStatusCache.stats().hitCount() - hitsBefore)
                .as("the other three were cache hits").isEqualTo(3);
    }

    @Test
    @DisplayName("logout evicts the cache entry, so the stale token is rejected on the very next request")
    void logoutIsEffectiveImmediatelyDespiteTheCache() throws Exception {
        User user = register();
        String token = bearer(user);

        mockMvc.perform(get("/api/v1/auth/me").header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk());

        authService.logout(user.getId()); // bumps tokenVersion AND evicts the cache

        mockMvc.perform(get("/api/v1/auth/me").header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("deactivating a staff member takes effect at once — the cache does not keep them signed in")
    void deactivationIsEffectiveImmediately() throws Exception {
        User owner = register();
        // A second user in the same pharmacy, deactivated via the staff path.
        User staff = userRepository.save(User.create(owner.getPharmacyId(), "Till Staff",
                "staff-" + UUID.randomUUID().toString().substring(0, 8) + "@test.local",
                "9000000010", "hash", Role.CASHIER));
        String staffToken = bearer(staff);

        mockMvc.perform(get("/api/v1/auth/me").header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk());

        authenticateAs(owner.getId(), owner.getPharmacyId(), Role.OWNER);
        try {
            staffService.deactivate(staff.getId());
        } finally {
            org.springframework.security.core.context.SecurityContextHolder.clearContext();
        }

        mockMvc.perform(get("/api/v1/auth/me").header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isUnauthorized());
    }
}
