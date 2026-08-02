package com.checkup.pharmacy.common.mail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Sends transactional email through Resend's REST API (no official Java SDK exists, so this
 * is a thin RestClient wrapper in the same shape as {@code SupabaseStorageClient}).
 *
 * Misconfiguration is a no-op, not a failure: if EMAIL_FROM or RESEND_API_KEY is missing the
 * send is skipped with a warning, so local dev and CI never fail on absent mail config. Once
 * both are set, a rejected send throws {@link EmailSendException} — callers on a
 * user-facing path are responsible for catching it.
 *
 * NOTE ON SENDING DOMAIN: Resend only accepts a From address on a domain verified in the
 * Resend account. EMAIL_FROM must stay on checkup.care; anything else comes back as a 403
 * validation error, which this class surfaces verbatim rather than retrying or rewriting.
 */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final String PREFIX = "[Email]";
    private static final String RESEND_BASE_URL = "https://api.resend.com";

    private final String from;
    private final String defaultFromName;
    private final ObjectMapper objectMapper;

    /** Null when RESEND_API_KEY is unset — the signal that sending is disabled. */
    private final RestClient resend;

    public EmailService(@Value("${app.mail.from:}") String from,
                        @Value("${app.mail.from-name:Checkup Pharmacy}") String defaultFromName,
                        @Value("${app.mail.resend-api-key:}") String resendApiKey,
                        ObjectMapper objectMapper) {
        this.from = from == null ? "" : from.trim();
        this.defaultFromName = defaultFromName;
        this.objectMapper = objectMapper;
        this.resend = (resendApiKey == null || resendApiKey.isBlank())
                ? null
                : RestClient.builder()
                        .baseUrl(RESEND_BASE_URL)
                        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + resendApiKey.trim())
                        .build();
    }

    /** True when both EMAIL_FROM and RESEND_API_KEY are configured. */
    public boolean isConfigured() {
        return !from.isBlank() && resend != null;
    }

    /**
     * Sends one email. Returns quietly when mail is not configured; throws
     * {@link EmailSendException} when a configured send is rejected.
     */
    public void send(EmailPayload payload) {
        if (from.isBlank()) {
            log.warn("{} EMAIL_FROM is not set — skipping \"{}\" to {}", PREFIX, payload.subject(), payload.to());
            return;
        }
        if (resend == null) {
            log.warn("{} RESEND_API_KEY is not set — skipping \"{}\" to {}", PREFIX, payload.subject(), payload.to());
            return;
        }

        String fromName = (payload.fromName() == null || payload.fromName().isBlank())
                ? defaultFromName
                : payload.fromName();
        String fromHeader = "\"%s\" <%s>".formatted(fromName, from);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("from", fromHeader);
        body.put("to", payload.to());
        body.put("subject", payload.subject());
        body.put("html", payload.html());
        if (payload.text() != null && !payload.text().isBlank()) {
            body.put("text", payload.text());
        }

        JsonNode response;
        try {
            response = resend.post()
                    .uri("/emails")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    // Resend signals failure with a non-2xx and a JSON body carrying the
                    // reason; without this the default handler throws a bare status error
                    // and the actual message (e.g. domain not verified) is lost.
                    .onStatus(HttpStatusCode::isError, (request, res) -> {
                        throw new EmailSendException(describeFailure(res.getStatusCode(), readBody(res.getBody())));
                    })
                    .body(JsonNode.class);
        } catch (RestClientException e) {
            throw new EmailSendException("%s send failed: %s".formatted(PREFIX, e.getMessage()), e);
        }

        String id = response != null && response.hasNonNull("id") ? response.get("id").asText() : null;
        log.info("{} sent \"{}\" to {} (id={})", PREFIX, payload.subject(), payload.to(), id);
    }

    private String readBody(java.io.InputStream in) {
        try (in) {
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    /**
     * Turns a Resend error body into a message worth reading in a log. Domain-verification
     * rejections get an explicit hint because they are a configuration problem (EMAIL_FROM is
     * on a domain this key cannot send from), not a transient failure to retry.
     */
    private String describeFailure(HttpStatusCode status, String rawBody) {
        String message = rawBody;
        try {
            JsonNode node = objectMapper.readTree(rawBody);
            if (node.hasNonNull("message")) {
                message = node.get("message").asText();
            }
        } catch (IOException ignored) {
            // Not JSON — fall back to the raw body.
        }

        String base = "%s Resend rejected the send (HTTP %s): %s".formatted(PREFIX, status.value(), message);
        if (message != null && message.toLowerCase().contains("domain")) {
            base += " — EMAIL_FROM (" + from + ") must be on a domain verified in the Resend account.";
        }
        return base;
    }
}
