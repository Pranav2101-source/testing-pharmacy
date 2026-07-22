package com.checkup.pharmacy.modules.pharmacy;

import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.pharmacy.dto.PharmacyResponse;
import com.checkup.pharmacy.modules.pharmacy.dto.UpdatePharmacyRequest;
import com.checkup.pharmacy.tenant.TenantContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads and updates the current tenant's pharmacy profile. Every operation is
 * scoped to {@link TenantContext#pharmacyId()} so a user can only ever see or
 * change their own pharmacy.
 */
@Service
public class PharmacyService {

    private final PharmacyRepository pharmacyRepository;
    private final ObjectMapper objectMapper;

    public PharmacyService(PharmacyRepository pharmacyRepository, ObjectMapper objectMapper) {
        this.pharmacyRepository = pharmacyRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public PharmacyResponse getCurrent() {
        return toResponse(load());
    }

    @Transactional
    public PharmacyResponse update(UpdatePharmacyRequest req) {
        Pharmacy p = load();
        p.setName(req.name().trim());
        p.setPhone(req.phone());
        p.setEmail(req.email());
        p.setGstin(req.gstin());
        p.setDrugLicense(req.drugLicense());
        p.setAddress(req.address());
        p.setCity(req.city());
        p.setState(req.state());
        p.setPincode(req.pincode());
        p.setLogoUrl(req.logoUrl());
        return toResponse(p);
    }

    @Transactional
    public PharmacyResponse updateDocuments(JsonNode documents) {
        Pharmacy p = load();
        p.setDocuments(documents == null || documents.isNull() ? null : documents.toString());
        return toResponse(p);
    }

    private Pharmacy load() {
        return pharmacyRepository.findById(TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Pharmacy not found"));
    }

    private PharmacyResponse toResponse(Pharmacy p) {
        return new PharmacyResponse(
                p.getName(),
                p.getPhone(),
                p.getEmail(),
                p.getGstin(),
                p.getDrugLicense(),
                p.getAddress(),
                p.getCity(),
                p.getState(),
                p.getPincode(),
                p.getLogoUrl(),
                null, // logoSignedUrl — filled once Supabase storage signing (D3) exists
                parseDocuments(p.getDocuments()));
    }

    private JsonNode parseDocuments(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(raw);
        } catch (Exception e) {
            // Stored value isn't valid JSON — don't fail the read; surface nothing.
            return null;
        }
    }
}
