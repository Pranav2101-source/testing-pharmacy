package com.checkup.pharmacy.modules.integration.emr;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;

/**
 * Turns a delivery exception into a sentence a pharmacist can act on, and a verdict on
 * whether trying again could ever help.
 *
 * <p>The classification exists because "javax.net.ssl.SSLHandshakeException: PKIX path
 * building failed" tells a pharmacist nothing, and the raw text is what would otherwise
 * land in the panel on their screen. The exception still goes to the log for whoever
 * debugs it; these words go to the person who has to decide whether to phone the clinic.
 */
record EmrDispenseFailureReason(String message, boolean retryable) {

    static EmrDispenseFailureReason notConfigured() {
        return new EmrDispenseFailureReason(
                "No clinic callback address is configured. Add it under Integrations.", false);
    }

    static EmrDispenseFailureReason noSecret() {
        return new EmrDispenseFailureReason(
                "No clinic connection key has been generated for this pharmacy yet.", false);
    }

    static EmrDispenseFailureReason of(Exception e) {
        // Order matters: HttpConnectTimeoutException extends HttpTimeoutException, so the
        // narrower one has to be tested first or every connect timeout reads as a read
        // timeout. Both families are matched because swapping HttpURLConnection for the JDK
        // HttpClient changed the type thrown here from SocketTimeoutException, and a miss
        // would silently degrade every timeout to the generic fallback.
        Throwable cause = e instanceof ResourceAccessException && e.getCause() != null ? e.getCause() : e;

        if (cause instanceof HttpConnectTimeoutException) {
            return new EmrDispenseFailureReason("The clinic's server did not answer in time.", true);
        }
        if (cause instanceof HttpTimeoutException) {
            return new EmrDispenseFailureReason("The clinic's server was too slow to reply.", true);
        }
        if (cause instanceof UnknownHostException) {
            return new EmrDispenseFailureReason("The clinic's server address could not be found.", true);
        }
        if (cause instanceof ConnectException) {
            return new EmrDispenseFailureReason("The clinic's server refused the connection.", true);
        }
        if (e instanceof HttpStatusCodeException http) {
            int code = http.getStatusCode().value();
            // 4xx is our fault or a stale agreement — the same request will fail the same way,
            // so retrying is just noise. 408 and 429 are the exceptions: both explicitly mean
            // "not now, try later".
            boolean retryable = code >= 500 || code == 408 || code == 429;
            return new EmrDispenseFailureReason(
                    "The clinic's server rejected the update (HTTP " + code + ").", retryable);
        }
        return new EmrDispenseFailureReason(
                "The update could not be delivered to the clinic.", true);
    }
}
