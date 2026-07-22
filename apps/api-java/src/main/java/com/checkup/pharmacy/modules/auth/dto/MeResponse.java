package com.checkup.pharmacy.modules.auth.dto;

/**
 * GET/PATCH /me shape: the profile with a nested pharmacy summary
 * ({ id, name, email, role, pharmacyId, pharmacy: { name, gstin, drugLicense } }).
 */
public record MeResponse(
        String id,
        String name,
        String email,
        String role,
        String pharmacyId,
        PharmacySummary pharmacy
) {
    public record PharmacySummary(String name, String gstin, String drugLicense) {
    }
}
