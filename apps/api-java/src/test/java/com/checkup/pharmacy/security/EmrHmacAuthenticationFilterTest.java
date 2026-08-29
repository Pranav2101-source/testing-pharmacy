package com.checkup.pharmacy.security;

import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The HMAC filter's own half of the prefix-trap guard — see
 * EmrApiKeyAuthenticationFilterTest for the compat filter's side of the same boundary.
 * Written because that side had a pinned regression test and this one had none at all, despite
 * both filters' shouldNotFilter being exactly the mechanism the "prefix trap" comments across
 * this module (SecurityConfig, EmrApiKeyAuthenticationFilter) warn about.
 */
@DisplayName("EMR HMAC filter: authenticates the native surface without touching the compat one")
class EmrHmacAuthenticationFilterTest {

    private static final Instant NOW = Instant.parse("2026-08-26T10:00:00Z");
    private static final String SECRET = "s3cret-value";
    // Base64 of exactly 32 raw bytes — EmrSecretCipher.key() requires that length after
    // decoding. Content is irrelevant for a test; it just has to be valid AES-256 key material.
    private static final String ENCRYPTION_KEY = java.util.Base64.getEncoder().encodeToString(new byte[32]);

    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final EmrSecretCipher secretCipher = new EmrSecretCipher(ENCRYPTION_KEY);
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final EmrHmacAuthenticationFilter filter =
            new EmrHmacAuthenticationFilter(pharmacyRepository, secretCipher, new ObjectMapper(), clock);

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
        MDC.clear();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The prefix trap — mirrors EmrApiKeyAuthenticationFilterTest's guard, from
    // this filter's side of the same boundary.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("does not touch the compat surface, a near-prefix of its own route")
    void ignoresTheCompatSurface() {
        assertThat(filter.shouldNotFilter(get("/api/v1/integration/pair"))).isTrue();
        assertThat(filter.shouldNotFilter(get("/api/v1/integration/prescriptions"))).isTrue();
        assertThat(filter.shouldNotFilter(get("/api/v1/integration/stock"))).isTrue();
    }

    @Test
    @DisplayName("does handle its own surface")
    void handlesTheHmacSurface() {
        assertThat(filter.shouldNotFilter(get("/api/v1/integrations/emr/prescriptions"))).isFalse();
        assertThat(filter.shouldNotFilter(get("/api/v1/integrations/emr/medicines/match"))).isFalse();
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
    @DisplayName("authenticates a validly signed request and scopes it to that pharmacy")
    void authenticatesValidSignature() throws Exception {
        Pharmacy pharmacy = pharmacyWithSecret();
        when(pharmacyRepository.findById(pharmacy.getId())).thenReturn(Optional.of(pharmacy));

        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilterInternal(signedRequest(pharmacy.getId(), "{}".getBytes()), response, chain);

        verify(chain).doFilter(any(), any());
        var auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        assertThat(((UserPrincipal) auth.getPrincipal()).pharmacyId()).isEqualTo(pharmacy.getId());
    }

    @Test
    @DisplayName("rejects a request signed with the wrong secret")
    void rejectsWrongSecret() throws Exception {
        Pharmacy pharmacy = pharmacyWithSecret();
        when(pharmacyRepository.findById(pharmacy.getId())).thenReturn(Optional.of(pharmacy));

        String timestamp = String.valueOf(NOW.getEpochSecond());
        byte[] body = "{}".getBytes();
        String badSignature = HmacSigner.sign("wrong-secret", timestamp, "POST",
                "/api/v1/integrations/emr/prescriptions", pharmacy.getId(), body);

        MockHttpServletRequest request = get("/api/v1/integrations/emr/prescriptions");
        request.setMethod("POST");
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, pharmacy.getId());
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, timestamp);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER, badSignature);

        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilterInternal(request, response, chain);

        verify(chain, never()).doFilter(any(), any());
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    @DisplayName("rejects a timestamp outside the clock-skew window, even with a correct signature for it")
    void rejectsExpiredTimestamp() throws Exception {
        Pharmacy pharmacy = pharmacyWithSecret();
        when(pharmacyRepository.findById(pharmacy.getId())).thenReturn(Optional.of(pharmacy));

        String staleTimestamp = String.valueOf(NOW.minusSeconds(600).getEpochSecond());
        byte[] body = "{}".getBytes();
        String signature = HmacSigner.sign(SECRET, staleTimestamp, "POST",
                "/api/v1/integrations/emr/prescriptions", pharmacy.getId(), body);

        MockHttpServletRequest request = get("/api/v1/integrations/emr/prescriptions");
        request.setMethod("POST");
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, pharmacy.getId());
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, staleTimestamp);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER, signature);

        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilterInternal(request, response, chain);

        verify(chain, never()).doFilter(any(), any());
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
    }

    @Test
    @DisplayName("rejects a request with no credential headers at all")
    void rejectsMissingHeaders() throws Exception {
        MockHttpServletRequest request = get("/api/v1/integrations/emr/prescriptions");
        request.setContent("{}".getBytes());
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilterInternal(request, response, chain);

        verify(chain, never()).doFilter(any(), any());
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_UNAUTHORIZED);
    }

    @Test
    @DisplayName("an unknown pharmacy and a correctly-signed-but-wrong-secret request are indistinguishable to the caller")
    void doesNotLeakWhichPharmaciesExist() throws Exception {
        when(pharmacyRepository.findById("ph-unknown")).thenReturn(Optional.empty());
        Pharmacy pharmacy = pharmacyWithSecret();
        when(pharmacyRepository.findById(pharmacy.getId())).thenReturn(Optional.of(pharmacy));

        String timestamp = String.valueOf(NOW.getEpochSecond());
        byte[] body = "{}".getBytes();

        String unknownSig = HmacSigner.sign("irrelevant", timestamp, "POST",
                "/api/v1/integrations/emr/prescriptions", "ph-unknown", body);
        MockHttpServletRequest unknownRequest = get("/api/v1/integrations/emr/prescriptions");
        unknownRequest.setMethod("POST");
        unknownRequest.setContent(body);
        unknownRequest.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, "ph-unknown");
        unknownRequest.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, timestamp);
        unknownRequest.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER, unknownSig);
        MockHttpServletResponse unknownResponse = new MockHttpServletResponse();
        filter.doFilterInternal(unknownRequest, unknownResponse, mock(FilterChain.class));
        SecurityContextHolder.clearContext();

        String wrongSig = HmacSigner.sign("wrong-secret", timestamp, "POST",
                "/api/v1/integrations/emr/prescriptions", pharmacy.getId(), body);
        MockHttpServletRequest wrongSecretRequest = get("/api/v1/integrations/emr/prescriptions");
        wrongSecretRequest.setMethod("POST");
        wrongSecretRequest.setContent(body);
        wrongSecretRequest.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, pharmacy.getId());
        wrongSecretRequest.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, timestamp);
        wrongSecretRequest.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER, wrongSig);
        MockHttpServletResponse wrongSecretResponse = new MockHttpServletResponse();
        filter.doFilterInternal(wrongSecretRequest, wrongSecretResponse, mock(FilterChain.class));

        // Same status AND same body: a response that distinguished the two would confirm
        // whether a given pharmacy id is real, and the pharmacy id travels in the clear.
        assertThat(unknownResponse.getStatus()).isEqualTo(wrongSecretResponse.getStatus());
        assertThat(unknownResponse.getContentAsString()).isEqualTo(wrongSecretResponse.getContentAsString());
    }

    private MockHttpServletRequest signedRequest(String pharmacyId, byte[] body) {
        String timestamp = String.valueOf(NOW.getEpochSecond());
        MockHttpServletRequest request = get("/api/v1/integrations/emr/prescriptions");
        request.setMethod("POST");
        request.setContent(body);
        String signature = HmacSigner.sign(SECRET, timestamp, "POST",
                request.getRequestURI(), pharmacyId, body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, pharmacyId);
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, timestamp);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER, signature);
        return request;
    }

    private static MockHttpServletRequest get(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", uri);
        request.setRequestURI(uri);
        return request;
    }

    private Pharmacy pharmacyWithSecret() {
        Pharmacy pharmacy = Pharmacy.create("Test Pharmacy", "test-pharmacy-hmac");
        EmrSecretCipher.Encrypted encrypted = secretCipher.encrypt(SECRET);
        pharmacy.setEmrSecret(encrypted.ciphertext(), encrypted.iv(), encrypted.tag(), null);
        return pharmacy;
    }
}
