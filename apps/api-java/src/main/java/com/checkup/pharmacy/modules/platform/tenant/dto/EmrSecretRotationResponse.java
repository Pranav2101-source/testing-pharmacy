package com.checkup.pharmacy.modules.platform.tenant.dto;

import java.time.Instant;

/**
 * Response for {@code POST /platform/tenants/{id}/emr-secret/rotate}. {@code secret}
 * is shown once — same "return it now, never again" pattern as
 * {@link CreateTenantResponse#temporaryPassword()} — for the platform admin to relay
 * out-of-band into the EMR side's pharmacy-connection form.
 */
public record EmrSecretRotationResponse(String secret, Instant rotatedAt) {
}
