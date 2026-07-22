package com.checkup.pharmacy.modules.platform.tenant.dto;

/**
 * Response for {@code POST /platform/tenants}. The frontend's NewPharmacyWizard
 * reads {@code pharmacy.tenantCode}, {@code pharmacy.name} and the top-level
 * {@code temporaryPassword} (shown once so the admin can hand it to the owner —
 * there is no D4 mailer yet to send it, so returning it here is the delivery
 * channel, and is what the wizard expects).
 */
public record CreateTenantResponse(TenantSummary pharmacy, String temporaryPassword) {

    public record TenantSummary(
            String id,
            String tenantCode,
            String name,
            OwnerInfo owner,
            SubscriptionInfo subscription,
            SettingsInfo settings) {
    }
}
