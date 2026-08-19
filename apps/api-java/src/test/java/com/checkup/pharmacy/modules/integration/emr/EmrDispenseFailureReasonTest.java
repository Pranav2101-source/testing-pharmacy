package com.checkup.pharmacy.modules.integration.emr;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What a failed delivery is turned into.
 *
 * <p>Two things are being protected here. The wording, because it lands on a pharmacist's
 * screen and "PKIX path building failed" tells them nothing about whether to phone the
 * clinic. And the retryable verdict, because getting it wrong is silent either way: a
 * retryable 401 is retried until the budget is gone and then reported as if the clinic
 * were down, while a non-retryable timeout is abandoned after one blip.
 */
class EmrDispenseFailureReasonTest {

    @Nested
    @DisplayName("transport failures are worth trying again")
    class Transport {

        @Test
        @DisplayName("a connect timeout is classified as connect, not read")
        void connectTimeoutIsNotReadTimeout() {
            // HttpConnectTimeoutException EXTENDS HttpTimeoutException, so a check in the wrong
            // order reports every connect timeout as a slow reply. The distinction matters to
            // whoever debugs it: one is "nothing is listening", the other is "something is, and
            // it is struggling".
            var reason = EmrDispenseFailureReason.of(new HttpConnectTimeoutException("timed out"));

            assertThat(reason.message()).contains("did not answer");
            assertThat(reason.retryable()).isTrue();
        }

        @Test
        @DisplayName("a read timeout says the server was slow")
        void readTimeout() {
            var reason = EmrDispenseFailureReason.of(new HttpTimeoutException("timed out"));

            assertThat(reason.message()).contains("too slow");
            assertThat(reason.retryable()).isTrue();
        }

        @Test
        @DisplayName("an unknown host is retryable — DNS recovers")
        void unknownHost() {
            var reason = EmrDispenseFailureReason.of(new UnknownHostException("emr.example"));

            assertThat(reason.message()).contains("could not be found");
            assertThat(reason.retryable()).isTrue();
        }

        @Test
        @DisplayName("the cause is unwrapped from Spring's ResourceAccessException")
        void unwrapsSpringWrapper() {
            // RestClient wraps transport failures, so classifying the outer exception would
            // send every one of them to the generic fallback and lose the specific wording.
            var wrapped = new ResourceAccessException("I/O error", new ConnectException("refused"));

            assertThat(EmrDispenseFailureReason.of(wrapped).message()).contains("refused the connection");
        }
    }

    @Nested
    @DisplayName("HTTP status decides whether retrying could ever help")
    class StatusCodes {

        @Test
        @DisplayName("5xx is retryable — the server is having a bad time")
        void serverErrorsRetry() {
            var reason = EmrDispenseFailureReason.of(
                    HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "Bad Gateway", null, null, null));

            assertThat(reason.message()).contains("502");
            assertThat(reason.retryable()).isTrue();
        }

        @Test
        @DisplayName("401 is NOT retryable — the same request fails the same way")
        void unauthorizedDoesNotRetry() {
            // The signature or the secret is wrong. Retrying it eighteen times over a day
            // changes nothing and buries the prescriptions whose failures are still actionable.
            var reason = EmrDispenseFailureReason.of(
                    HttpClientErrorException.create(HttpStatus.UNAUTHORIZED, "Unauthorized", null, null, null));

            assertThat(reason.retryable()).isFalse();
        }

        @Test
        @DisplayName("429 and 408 are the 4xx exceptions: both mean 'not now'")
        void backpressureCodesRetry() {
            assertThat(EmrDispenseFailureReason.of(HttpClientErrorException.create(
                    HttpStatus.TOO_MANY_REQUESTS, "Too Many Requests", null, null, null)).retryable())
                    .as("429 is an explicit instruction to come back later")
                    .isTrue();
            assertThat(EmrDispenseFailureReason.of(HttpClientErrorException.create(
                    HttpStatus.REQUEST_TIMEOUT, "Request Timeout", null, null, null)).retryable())
                    .isTrue();
        }
    }

    @Nested
    @DisplayName("configuration problems are terminal, and say what to fix")
    class Configuration {

        @Test
        @DisplayName("no callback address configured is not retried")
        void notConfigured() {
            var reason = EmrDispenseFailureReason.notConfigured();

            assertThat(reason.retryable())
                    .as("no amount of retrying supplies a URL nobody has set")
                    .isFalse();
            assertThat(reason.message()).contains("callback address");
        }

        @Test
        @DisplayName("no key generated yet is distinct from no address configured")
        void noSecret() {
            // Two different fixes — generate a key, versus enter the clinic's address — so
            // they must not collapse into one message.
            assertThat(EmrDispenseFailureReason.noSecret().retryable()).isFalse();
            assertThat(EmrDispenseFailureReason.noSecret().message()).contains("key");
            assertThat(EmrDispenseFailureReason.noSecret().message())
                    .isNotEqualTo(EmrDispenseFailureReason.notConfigured().message());
        }
    }

    @Test
    @DisplayName("an unrecognised failure is retryable, and leaks no stack trace")
    void unknownFailureIsGenericAndRetryable() {
        var reason = EmrDispenseFailureReason.of(new IllegalStateException("kaboom at line 42"));

        assertThat(reason.retryable())
                .as("defaulting to retryable errs towards eventually delivering")
                .isTrue();
        assertThat(reason.message())
                .as("the raw exception belongs in the log, not on a pharmacist's screen")
                .doesNotContain("kaboom");
    }
}
