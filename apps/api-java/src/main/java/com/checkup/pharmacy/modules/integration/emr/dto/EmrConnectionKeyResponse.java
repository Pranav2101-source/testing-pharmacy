package com.checkup.pharmacy.modules.integration.emr.dto;

import java.time.Instant;

/**
 * The plaintext connection key, returned exactly once — same "copy it now, it is
 * never shown again" contract as the platform-admin rotation endpoint, because it
 * is the same key and it is only ever stored encrypted.
 */
public record EmrConnectionKeyResponse(String key, Instant generatedAt) {
}
