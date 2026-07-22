package com.checkup.pharmacy.modules.pharmacy.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * GET/PUT /pharmacy shape (the frontend's PharmacyProfile). `logoSignedUrl` is
 * null until Supabase storage signing (D3) exists; `documents` is the parsed
 * compliance-document JSON.
 */
public record PharmacyResponse(
        String name,
        String phone,
        String email,
        String gstin,
        String drugLicense,
        String address,
        String city,
        String state,
        String pincode,
        String logoUrl,
        String logoSignedUrl,
        JsonNode documents
) {
}
