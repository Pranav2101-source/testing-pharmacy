package com.checkup.pharmacy.security;

import com.checkup.pharmacy.common.enums.TenantStatus;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("EMR API-key filter: authenticates the compat surface without touching the HMAC one")
class EmrApiKeyAuthenticationFilterTest {

    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final EmrApiKeyAuthenticationFilter filter =
            new EmrApiKeyAuthenticationFilter(pharmacyRepository, new ObjectMapper());

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The prefix trap. "/api/v1/integration" is a strict prefix of
    // "/api/v1/integrations", so a filter matching the former WITHOUT a trailing
    // slash also captures every HMAC route — two filters on one request, the
    // second overwriting or rejecting what the first decided. These two tests
    // are the guard on that, and they are the reason the constant has a slash.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("does not touch the HMAC surface, whose prefix it nearly matches")
    void ignoresTheHmacSurface() {
        assertThat(filter.shouldNotFilter(get("/api/v1/integrations/emr/prescriptions"))).isTrue();
        assertThat(filter.shouldNotFilter(get("/api/v1/integrations/emr/medicines/match"))).isTrue();
    }

    @Test
    @DisplayName("does handle its own surface")
    void handlesTheCompatSurface() {
        assertThat(filter.shouldNotFilter(get("/api/v1/integration/prescriptions"))).isFalse();
        assertThat(filter.shouldNotFilter(get("/api/v1/integration/stock"))).isFalse();
    }

    @Test
    @DisplayName("lets pairing through unauthenticated — it is where credentials come from")
    void skipsPairing() {
        assertThat(filter.shouldNotFilter(get("/api/v1/integration/pair"))).isTrue();
    }

    @Test
    @DisplayName("ignores everything outside both surfaces")
    void ignoresUnrelatedRoutes() {
        assertThat(filter.shouldNotFilter(get("/api/v1/prescriptions"))).isTrue();
        assertThat(filter.shouldNotFilter(get("/api/v1/billing/invoices"))).isTrue();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Credential checking
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("authenticates a valid key/secret pair and scopes it to that pharmacy")
    void authenticatesValidCredentials() throws Exception {
        Pharmacy pharmacy = pharmacyWithSecret("s3cret-value");
        when(pharmacyRepository.findByEmrApiKey("pk_live")).thenReturn(Optional.of(pharmacy));

        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilterInternal(withCredentials("pk_live", "s3cret-value"), response, chain);

        verify(chain).doFilter(any(), any());
        var auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        assertThat(((UserPrincipal) auth.getPrincipal()).pharmacyId()).isEqualTo(pharmacy.getId());
    }

    @Test
    @DisplayName("rejects a wrong secret without calling the chain")
    void rejectsWrongSecret() throws Exception {
        Pharmacy pharmacy = pharmacyWithSecret("s3cret-value");
        when(pharmacyRepository.findByEmrApiKey("pk_live")).thenReturn(Optional.of(pharmacy));

        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilterInternal(withCredentials("pk_live", "wrong"), response, chain);

        verify(chain, never()).doFilter(any(), any());
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    @DisplayName("rejects an inactive pharmacy even with a correct credential")
    void rejectsInactivePharmacy() throws Exception {
        Pharmacy pharmacy = pharmacyWithSecret("s3cret-value");
        pharmacy.applyStatus(TenantStatus.SUSPENDED, false);
        when(pharmacyRepository.findByEmrApiKey("pk_live")).thenReturn(Optional.of(pharmacy));

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        filter.doFilterInternal(withCredentials("pk_live", "s3cret-value"), response, chain);

        verify(chain, never()).doFilter(any(), any());
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
    }

    @Test
    @DisplayName("an unknown key and a wrong secret are indistinguishable to the caller")
    void doesNotLeakWhichKeysExist() throws Exception {
        when(pharmacyRepository.findByEmrApiKey("pk_nope")).thenReturn(Optional.empty());
        Pharmacy pharmacy = pharmacyWithSecret("s3cret-value");
        when(pharmacyRepository.findByEmrApiKey("pk_live")).thenReturn(Optional.of(pharmacy));

        MockHttpServletResponse unknownKey = new MockHttpServletResponse();
        filter.doFilterInternal(withCredentials("pk_nope", "anything"), unknownKey,
                mock(FilterChain.class));
        SecurityContextHolder.clearContext();

        MockHttpServletResponse wrongSecret = new MockHttpServletResponse();
        filter.doFilterInternal(withCredentials("pk_live", "wrong"), wrongSecret,
                mock(FilterChain.class));

        // Same status AND same body: a response that distinguished the two would confirm
        // which keys exist, and the key half travels in the clear on every request.
        assertThat(unknownKey.getStatus()).isEqualTo(wrongSecret.getStatus());
        assertThat(unknownKey.getContentAsString()).isEqualTo(wrongSecret.getContentAsString());
    }

    @Test
    @DisplayName("rejects a request with no credential headers at all")
    void rejectsMissingHeaders() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        filter.doFilterInternal(get("/api/v1/integration/prescriptions"), response, chain);

        verify(chain, never()).doFilter(any(), any());
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
    }

    private static MockHttpServletRequest get(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", uri);
        request.setRequestURI(uri);
        return request;
    }

    private static MockHttpServletRequest withCredentials(String key, String secret) {
        MockHttpServletRequest request = get("/api/v1/integration/prescriptions");
        request.addHeader(EmrApiKeyAuthenticationFilter.KEY_HEADER, key);
        request.addHeader(EmrApiKeyAuthenticationFilter.SECRET_HEADER, secret);
        return request;
    }

    private static Pharmacy pharmacyWithSecret(String secret) {
        Pharmacy pharmacy = Pharmacy.create("Test Pharmacy", "test-pharmacy");
        pharmacy.pairEmrClinic("clinic-1", "Apollo Clinic", "https://clinic.example/api/v1/pharmacy/webhooks/dispense",
                "lnk_1", "pk_live", ApiSecretHasher.hash(secret));
        return pharmacy;
    }
}
