package com.checkup.pharmacy.security;

import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HmacSignerTest {

    private static final String SECRET = "integration-test-secret-that-is-long-enough";
    private static final String ENCRYPTION_KEY =
            "28006bb7bc6274957e3fc03f5e60a9a5d4c767c5212e90dc83214bc3117d68bc";
    private static final String TIMESTAMP = "1787133600";
    private static final Instant NOW = Instant.ofEpochSecond(Long.parseLong(TIMESTAMP));

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
        MDC.clear();
    }

    @Test
    void signatureBindsBodyTenantMethodAndPath() {
        byte[] body = "{\"externalPrescriptionId\":\"rx-1\"}".getBytes(StandardCharsets.UTF_8);
        String signature = HmacSigner.sign(SECRET, TIMESTAMP, "POST",
                "/api/v1/integrations/emr/prescriptions", "ph-1", body);

        assertThat(HmacSigner.verify(signature, signature)).isTrue();
        assertThat(HmacSigner.verify(signature, HmacSigner.sign(SECRET, TIMESTAMP, "POST",
                "/api/v1/integrations/emr/prescriptions", "ph-2", body))).isFalse();
        assertThat(HmacSigner.verify(signature, HmacSigner.sign(SECRET, TIMESTAMP, "GET",
                "/api/v1/integrations/emr/prescriptions", "ph-1", body))).isFalse();
    }

    @Test
    void validSignedRequestAuthenticatesTenantAndPreservesBodyForJsonBinding() throws Exception {
        Fixture fx = fixture(SECRET);
        String path = "/api/v1/integrations/emr/prescriptions";
        byte[] body = "{\"externalPrescriptionId\":\"rx-1\"}".getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, fx.pharmacyId());
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, TIMESTAMP);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER,
                HmacSigner.sign(SECRET, TIMESTAMP, "POST", path, fx.pharmacyId(), body));
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> forwardedBody = new AtomicReference<>();

        fx.filter().doFilter(request, response, (forwardedRequest, forwardedResponse) -> forwardedBody.set(
                new String(forwardedRequest.getInputStream().readAllBytes(), StandardCharsets.UTF_8)));

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(forwardedBody.get()).isEqualTo(new String(body, StandardCharsets.UTF_8));
        assertThat(((UserPrincipal) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).pharmacyId())
                .isEqualTo(fx.pharmacyId());
    }

    @Test
    void staleTimestampIsRejectedBeforeTheController() throws Exception {
        Fixture fx = fixture(SECRET);
        String path = "/api/v1/integrations/emr/prescriptions";
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        String stale = Long.toString(NOW.minusSeconds(301).getEpochSecond());
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, fx.pharmacyId());
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, stale);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER,
                HmacSigner.sign(SECRET, stale, "POST", path, fx.pharmacyId(), body));
        MockHttpServletResponse response = new MockHttpServletResponse();

        fx.filter().doFilter(request, response, (forwardedRequest, forwardedResponse) -> { });

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void unknownPharmacyIsRejectedWithGenericMessage() throws Exception {
        Fixture fx = fixture(SECRET);
        String path = "/api/v1/integrations/emr/prescriptions";
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, "unknown-pharmacy");
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, TIMESTAMP);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER,
                HmacSigner.sign(SECRET, TIMESTAMP, "POST", path, "unknown-pharmacy", body));
        MockHttpServletResponse response = new MockHttpServletResponse();

        fx.filter().doFilter(request, response, (forwardedRequest, forwardedResponse) -> { });

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("Invalid EMR authentication signature");
    }

    @Test
    void pharmacyThatHasGeneratedNoKeyIsRejected() throws Exception {
        // The key IS the permission now that no feature flag gates this surface: a pharmacy
        // that never generated one — or disconnected its clinic, which clears it — has
        // nothing to verify against, and a forged signature must not get in on its behalf.
        Fixture fx = fixture(null);
        String path = "/api/v1/integrations/emr/prescriptions";
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, fx.pharmacyId());
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, TIMESTAMP);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER,
                HmacSigner.sign(SECRET, TIMESTAMP, "POST", path, fx.pharmacyId(), body));
        MockHttpServletResponse response = new MockHttpServletResponse();

        fx.filter().doFilter(request, response, (forwardedRequest, forwardedResponse) -> { });

        assertThat(response.getStatus()).isEqualTo(401);
    }

    @Test
    void oneTenantCannotImpersonateAnotherByChangingThePharmacyHeader() throws Exception {
        // Regression test for the cross-tenant impersonation gap this filter closes:
        // a signature valid for pharmacy A's own secret must not authenticate a
        // request that claims to be pharmacy B, even though both are known, active,
        // connected pharmacies.
        PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
        EmrSecretCipher secretCipher = new EmrSecretCipher(ENCRYPTION_KEY);

        Pharmacy pharmacyA = registerPharmacy(pharmacyRepository, secretCipher,
                "Pharmacy A", "pharmacy-a", "secret-for-pharmacy-a");
        Pharmacy pharmacyB = registerPharmacy(pharmacyRepository, secretCipher,
                "Pharmacy B", "pharmacy-b", "secret-for-pharmacy-b");

        EmrHmacAuthenticationFilter filter = new EmrHmacAuthenticationFilter(pharmacyRepository,
                secretCipher, new ObjectMapper(), Clock.fixed(NOW, ZoneOffset.UTC));

        String path = "/api/v1/integrations/emr/prescriptions";
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        String signedWithAButClaimingB = HmacSigner.sign("secret-for-pharmacy-a", TIMESTAMP, "POST", path,
                pharmacyB.getId(), body);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setContent(body);
        request.addHeader(EmrHmacAuthenticationFilter.PHARMACY_HEADER, pharmacyB.getId());
        request.addHeader(EmrHmacAuthenticationFilter.TIMESTAMP_HEADER, TIMESTAMP);
        request.addHeader(EmrHmacAuthenticationFilter.SIGNATURE_HEADER, signedWithAButClaimingB);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (forwardedRequest, forwardedResponse) -> { });

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(pharmacyA.getId()).isNotEqualTo(pharmacyB.getId());
    }

    private record Fixture(String pharmacyId, EmrHmacAuthenticationFilter filter) {
    }

    private Fixture fixture(String secret) {
        PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
        EmrSecretCipher secretCipher = new EmrSecretCipher(ENCRYPTION_KEY);

        Pharmacy pharmacy = registerPharmacy(pharmacyRepository, secretCipher,
                "Test Pharmacy", "test-pharmacy", secret);

        EmrHmacAuthenticationFilter filter = new EmrHmacAuthenticationFilter(pharmacyRepository,
                secretCipher, new ObjectMapper(), Clock.fixed(NOW, ZoneOffset.UTC));
        return new Fixture(pharmacy.getId(), filter);
    }

    /** A null secret registers a pharmacy that has never generated a connection key. */
    private Pharmacy registerPharmacy(PharmacyRepository pharmacyRepository,
                                      EmrSecretCipher secretCipher, String name, String slug, String secret) {
        Pharmacy pharmacy = Pharmacy.create(name, slug);
        if (secret != null) {
            EmrSecretCipher.Encrypted encrypted = secretCipher.encrypt(secret);
            pharmacy.setEmrSecret(encrypted.ciphertext(), encrypted.iv(), encrypted.tag());
        }
        when(pharmacyRepository.findById(pharmacy.getId())).thenReturn(Optional.of(pharmacy));
        return pharmacy;
    }
}
