package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.medicine.dto.CreateLocalMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.PendingLocalMedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.PharmacyMedicineResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pharmacy-local medicine identities — see {@link PharmacyMedicine}'s javadoc for
 * why these exist. Scoped entirely to the caller's own pharmacy; never touches the
 * shared global {@link Medicine} catalog except to read/confirm a link.
 */
@Service
public class PharmacyMedicineService {

    private static final int SUGGESTIONS_PER_ITEM = 3;

    private final PharmacyMedicineRepository pharmacyMedicineRepository;
    private final MedicineRepository medicineRepository;

    public PharmacyMedicineService(PharmacyMedicineRepository pharmacyMedicineRepository,
                                   MedicineRepository medicineRepository) {
        this.pharmacyMedicineRepository = pharmacyMedicineRepository;
        this.medicineRepository = medicineRepository;
    }

    /**
     * "Save as Local Medicine" — the GRN quick-add flow's replacement for inline-creating
     * a global catalog medicine. Reuses this pharmacy's existing local row for the same
     * exact name rather than forking a duplicate, same as the GRN import path.
     */
    @Transactional
    public PharmacyMedicineResponse create(CreateLocalMedicineRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        PharmacyMedicine m = pharmacyMedicineRepository.findFirstByPharmacyIdAndNameIgnoreCase(pharmacyId, req.name())
                .orElseGet(() -> pharmacyMedicineRepository.save(PharmacyMedicine.create(pharmacyId, req.name(),
                        blankToNull(req.manufacturer()), blankToNull(req.genericName()), blankToNull(req.strength()),
                        blankToNull(req.form()), blankToNull(req.unit()), blankToNull(req.hsnCode()), req.gstRate(),
                        blankToNull(req.schedule()))));
        return toResponse(m);
    }

    /**
     * Local medicines the background matcher found only a fuzzy (similarity-score)
     * candidate for — never {@code KEPT_LOCAL} (no candidate at all, nothing to review)
     * and never {@code LINKED} (already resolved). Suggestions are computed live, not
     * persisted, so a since-added catalogue medicine can still surface even for an
     * older pending row.
     */
    @Transactional(readOnly = true)
    public List<PendingLocalMedicineResponse> listPending() {
        String pharmacyId = TenantContext.pharmacyId();
        List<PharmacyMedicine> pending = pharmacyMedicineRepository
                .findByPharmacyIdAndMatchStatusOrderByCreatedAtDesc(pharmacyId, MedicineMatchStatus.SUGGESTED);
        if (pending.isEmpty()) {
            return List.of();
        }

        String[] terms = pending.stream().map(PharmacyMedicine::getName).distinct().toArray(String[]::new);
        Map<String, List<PendingLocalMedicineResponse.Suggestion>> byName = new HashMap<>();
        for (var row : medicineRepository.findSimilarByNames(terms, SUGGESTIONS_PER_ITEM)) {
            byName.computeIfAbsent(row.getTerm(), k -> new java.util.ArrayList<>())
                    .add(new PendingLocalMedicineResponse.Suggestion(row.getId(), row.getName(),
                            row.getGenericName(), row.getStrength(), row.getForm(), row.getSimilarity()));
        }

        return pending.stream().map(m -> new PendingLocalMedicineResponse(m.getId(), m.getName(), m.getManufacturer(),
                m.getGenericName(), m.getStrength(), m.getForm(), m.getHsnCode(), m.getGstRate(), m.getCreatedAt(),
                byName.getOrDefault(m.getName(), List.of()))).toList();
    }

    /**
     * A pharmacist confirms (or manually picks) the global catalogue medicine a local one
     * really is. Additive only — never rewrites any existing GRN item, batch, or invoice
     * line; only this identity row changes, so every future lookup benefits going forward.
     */
    @Transactional
    public PharmacyMedicineResponse confirmLink(String id, String medicineId) {
        PharmacyMedicine m = pharmacyMedicineRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Local medicine not found"));
        Medicine target = medicineRepository.findById(medicineId)
                .orElseThrow(() -> new NotFoundException("Medicine not found"));
        if (!target.isActive()) {
            throw new UnprocessableEntityException("\"" + target.getName() + "\" is inactive and cannot be linked");
        }
        m.confirmLink(target.getId());
        return toResponse(m);
    }

    private static PharmacyMedicineResponse toResponse(PharmacyMedicine m) {
        return new PharmacyMedicineResponse(m.getId(), m.getName(), m.getManufacturer(), m.getGenericName(),
                m.getStrength(), m.getForm(), m.getUnit(), m.getHsnCode(), m.getGstRate(), m.getSchedule(),
                m.getMatchStatus().name(), m.getLinkedMedicineId());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
