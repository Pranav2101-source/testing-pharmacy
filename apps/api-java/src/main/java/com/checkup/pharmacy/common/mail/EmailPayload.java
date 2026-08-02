package com.checkup.pharmacy.common.mail;

/**
 * One transactional email. {@code text} and {@code fromName} are optional — pass null to
 * fall back to the configured defaults.
 */
public record EmailPayload(
        String to,
        String subject,
        String html,
        String text,
        String fromName
) {
    public EmailPayload(String to, String subject, String html) {
        this(to, subject, html, null, null);
    }
}
