package com.checkup.pharmacy.modules.pharmacy;

import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.tax.IndianState;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
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

    /**
     * Validates and canonicalises the pharmacy's own tax identity.
     *
     * <p>Mirrors {@code SupplierService.validateTaxIdentity} deliberately. That check has
     * always existed for SUPPLIERS, and never for the pharmacy itself — even though the
     * pharmacy's state is one half of every inter-state comparison the system makes, for
     * sales, purchases and debit notes alike. One live record held {@code "cjd9949"} as a
     * state; another held {@code "karnataka"} beside a GSTIN whose code said Chhattisgarh.
     * Both were typed here, and nothing objected.
     *
     * <p>Returns the CANONICAL spelling to store, so the column converges on one rendering
     * of each name instead of accumulating variants.
     *
     * <p>A blank state is still allowed. It is the honest state of a pharmacy that has not
     * finished setting itself up, the tax code fails safe to intra-state without it, and the
     * GSTR-3B sheet already reports it as a blocking gap. Refusing to save a half-filled
     * settings form would be a worse answer than the one the sheet already gives.
     */
    private String validateAndCanonicaliseState(UpdatePharmacyRequest req) {
        String state = req.state() == null ? null : req.state().trim();
        if (state == null || state.isEmpty()) {
            return state;
        }
        IndianState resolved = IndianState.fromName(state)
                .orElseThrow(() -> new BadRequestException("\"" + state
                        + "\" is not a recognised Indian state or union territory. Pick the state from "
                        + "the list — it decides whether your sales and purchases attract IGST, and "
                        + "every GST return is built from that decision."));

        String gstin = req.gstin() == null ? null : req.gstin().trim();
        if (gstin == null || gstin.isEmpty()) {
            return resolved.displayName();
        }
        if (!gstin.matches(IndianState.GSTIN_PATTERN)) {
            throw new BadRequestException("\"" + gstin + "\" is not a valid GSTIN. A GSTIN is "
                    + IndianState.GSTIN_LENGTH + " characters, starting with a two-digit state code. "
                    + "Nothing can be filed without a valid one.");
        }
        IndianState fromGstin = IndianState.fromGstin(gstin).orElseThrow(() ->
                new BadRequestException("Your GSTIN starts with \"" + gstin.substring(0, 2)
                        + "\", which is not a valid GST state code."));
        if (fromGstin != resolved) {
            // The GSTIN wins on authority — the code is assigned by the tax authority, not
            // typed — but we refuse rather than silently overwrite: one of the two is wrong
            // and only the person entering it knows which.
            throw new BadRequestException("Your GSTIN belongs to " + fromGstin.displayName()
                    + ", but the state is set to " + resolved.displayName()
                    + ". Correct whichever is wrong — they must agree, or every inter-state "
                    + "decision on your returns is made against the wrong state.");
        }
        return resolved.displayName();
    }

    @Transactional
    public PharmacyResponse update(UpdatePharmacyRequest req) {
        // Before any mutation, so a rejected tax identity leaves the record untouched rather
        // than half-updated.
        String canonicalState = validateAndCanonicaliseState(req);
        Pharmacy p = load();
        p.setName(req.name().trim());
        // Stored as the bare 10 digits, the same shape registration stores, so the two
        // write paths cannot leave the column in two different formats — invoice
        // rendering and any future lookup-by-phone both read one canonical value.
        p.setPhone(ValidationPatterns.normalizeMobile(req.phone()));
        p.setEmail(req.email() == null ? null : req.email().trim());
        p.setGstin(req.gstin());
        p.setDrugLicense(req.drugLicense());
        p.setAddress(req.address());
        p.setCity(req.city());
        p.setState(canonicalState);
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
