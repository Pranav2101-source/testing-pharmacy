package com.checkup.pharmacy.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The clinic's {@code PharmacyWebhookVerifier} checks this signature in a different
 * repository this codebase cannot compile against or call in a test, so nothing here can
 * catch a drift by exercising the other side directly. What CAN catch it: an
 * independently-computed known-answer vector, pinned by reading the other repo's algorithm
 * once rather than by testing this class against itself. See
 * {@code project_dispense_callback_phase3} for why this pattern exists — an HMAC contract
 * shared across two codebases has drifted silently before.
 */
class LegacyWebhookSignerTest {

    private static final Pattern HEADER_SHAPE = Pattern.compile("^t=(\\d+),v1=([0-9a-f]{64})$");

    @Test
    @DisplayName("matches an independently-computed HMAC-SHA256 of \"<timestamp>.<rawBody>\"")
    void matchesTheClinicsAlgorithm() {
        // Computed independently against the algorithm PharmacyWebhookVerifier.hmacHex
        // implements: HMAC-SHA256("test-webhook-secret",
        // "1700000000.{\"emrPrescriptionId\":\"rx-1\"}"), lower-case hex. This calls the real
        // production overload — the three-argument one exists exactly so this test can be
        // deterministic without needing a real live call to the other repository.
        String header = LegacyWebhookSigner.header(
                "test-webhook-secret", "{\"emrPrescriptionId\":\"rx-1\"}", "1700000000");

        assertThat(header)
                .isEqualTo("t=1700000000,v1=d56d218314ccd0dc1fb52e81a748bdb0c218ab8b70676270bc6869986c46f053");
    }

    @Test
    @DisplayName("the header matches the shape the clinic's receiver parses: t=<epoch>,v1=<64 lowercase hex>")
    void headerShapeMatchesWhatTheReceiverParses() {
        String header = LegacyWebhookSigner.header("some-secret", "{}");

        assertThat(HEADER_SHAPE.matcher(header).matches())
                .as("header %s must match t=<epoch>,v1=<64 lowercase hex>", header)
                .isTrue();
    }

    @Test
    @DisplayName("the default overload stamps the current time")
    void defaultOverloadStampsNow() {
        String header = LegacyWebhookSigner.header("some-secret", "{}");
        Matcher m = HEADER_SHAPE.matcher(header);
        assertThat(m.matches()).isTrue();

        long headerEpoch = Long.parseLong(m.group(1));
        assertThat(Math.abs(Instant.now().getEpochSecond() - headerEpoch)).isLessThan(5);
    }

    @Test
    @DisplayName("different bodies produce different signatures — the body is bound into the material")
    void differentBodiesSignDifferently() {
        String a = LegacyWebhookSigner.header("secret", "{\"a\":1}", "1700000000");
        String b = LegacyWebhookSigner.header("secret", "{\"a\":2}", "1700000000");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    @DisplayName("different secrets produce different signatures for the same body")
    void differentSecretsSignDifferently() {
        String a = LegacyWebhookSigner.header("secret-one", "{}", "1700000000");
        String b = LegacyWebhookSigner.header("secret-two", "{}", "1700000000");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    @DisplayName("the same secret, body and timestamp always sign the same way")
    void signingIsDeterministic() {
        String a = LegacyWebhookSigner.header("secret", "{\"x\":1}", "1700000000");
        String b = LegacyWebhookSigner.header("secret", "{\"x\":1}", "1700000000");
        assertThat(a).isEqualTo(b);
    }

    @Test
    @DisplayName("a blank secret refuses to sign rather than producing a meaningless signature")
    void refusesToSignWithoutASecret() {
        assertThatThrownBy(() -> LegacyWebhookSigner.header("", "{}"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> LegacyWebhookSigner.header(null, "{}"))
                .isInstanceOf(IllegalStateException.class);
    }
}
