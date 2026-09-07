package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.concurrency.AdvisoryLock;
import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.tax.GstRates;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.medicine.dto.CreateLocalMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.LocalMedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.PendingLocalMedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.PharmacyMedicineResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    private final AuditService auditService;
    private final AdvisoryLock advisoryLock;

    public PharmacyMedicineService(PharmacyMedicineRepository pharmacyMedicineRepository,
                                   MedicineRepository medicineRepository,
                                   AuditService auditService, AdvisoryLock advisoryLock) {
        this.pharmacyMedicineRepository = pharmacyMedicineRepository;
        this.medicineRepository = medicineRepository;
        this.auditService = auditService;
        this.advisoryLock = advisoryLock;
    }

    /**
     * "Save as Local Medicine" — the GRN quick-add flow's replacement for inline-creating
     * a global catalog medicine. Reuses this pharmacy's existing local row for the same
     * exact name rather than forking a duplicate, same as the GRN import path.
     */
    @Transactional
    public PharmacyMedicineResponse create(CreateLocalMedicineRequest req) {
        GstRates.requireAllowed(req.gstRate());
        String pharmacyId = TenantContext.pharmacyId();
        // Same find-or-create race as the GRN path (PurchasesService.resolveMedicineRefs) —
        // see AdvisoryLock. A pharmacist saving a local medicine here at the same moment
        // another GRN resolves the identical name must not create two identities for it.
        advisoryLock.acquire(pharmacyId + "|pharmacy_medicine|" + MedicineMatcher.normalize(req.name()));
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
        String pharmacyId = TenantContext.pharmacyId();
        PharmacyMedicine m = pharmacyMedicineRepository.findByIdAndPharmacyId(id, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Local medicine not found"));
        Medicine target = medicineRepository.findById(medicineId)
                .orElseThrow(() -> new NotFoundException("Medicine not found"));
        if (!target.isActive()) {
            throw new UnprocessableEntityException("\"" + target.getName() + "\" is inactive and cannot be linked");
        }
        String previousStatus = m.getMatchStatus().name();
        m.confirmLink(target.getId());
        auditService.log(AuditEntry.of(AuditModule.INVENTORY, "LOCAL_MEDICINE_LINKED", "PHARMACY_MEDICINE")
                .pharmacyId(pharmacyId).userId(TenantContext.userId()).entityId(m.getId()).resourceName(m.getName())
                .oldData(Map.of("matchStatus", previousStatus))
                .newData(Map.of("matchStatus", m.getMatchStatus().name(), "linkedMedicineId", target.getId(),
                        "linkedMedicineName", target.getName())));
        return toResponse(m);
    }

    /**
     * Undoes a link — a pharmacist confirmed the wrong global medicine. See
     * {@link PharmacyMedicine#unlink()} for why this lands on {@code KEPT_LOCAL}, not
     * {@code PENDING}. Additive/reversible in the same sense as {@link #confirmLink}: no
     * GRN item, batch, or invoice line is ever touched, since none of them stored the
     * global medicineId to begin with — only this identity row's own link changes.
     */
    @Transactional
    public PharmacyMedicineResponse unlink(String id) {
        String pharmacyId = TenantContext.pharmacyId();
        PharmacyMedicine m = pharmacyMedicineRepository.findByIdAndPharmacyId(id, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Local medicine not found"));
        if (m.getMatchStatus() != MedicineMatchStatus.LINKED) {
            throw new BadRequestException("\"" + m.getName() + "\" is not currently linked");
        }
        String previousLinkedId = m.getLinkedMedicineId();
        m.unlink();
        auditService.log(AuditEntry.of(AuditModule.INVENTORY, "LOCAL_MEDICINE_UNLINKED", "PHARMACY_MEDICINE")
                .pharmacyId(pharmacyId).userId(TenantContext.userId()).entityId(m.getId()).resourceName(m.getName())
                .oldData(Map.of("linkedMedicineId", previousLinkedId == null ? "" : previousLinkedId))
                .newData(Map.of("matchStatus", m.getMatchStatus().name())));
        return toResponse(m);
    }

    /**
     * Every local medicine this pharmacy has, any status — the full directory, unlike
     * {@link #listPending} which only ever shows {@code SUGGESTED} rows. Lets a pharmacist
     * find and manually link a {@code KEPT_LOCAL} row (no fuzzy candidate at all, so it
     * never appears in the pending review list) or unlink an already-{@code LINKED} one.
     */
    @Transactional(readOnly = true)
    public List<LocalMedicineResponse> listAll() {
        String pharmacyId = TenantContext.pharmacyId();
        List<PharmacyMedicine> all = pharmacyMedicineRepository.findByPharmacyIdOrderByCreatedAtDesc(pharmacyId);
        if (all.isEmpty()) {
            return List.of();
        }

        List<PharmacyMedicine> unlinked = all.stream()
                .filter(m -> m.getMatchStatus() != MedicineMatchStatus.LINKED).toList();

        // Suggestions — same live, non-persisted lookup as listPending().
        Map<String, List<PendingLocalMedicineResponse.Suggestion>> suggestionsByName = new HashMap<>();
        if (!unlinked.isEmpty()) {
            String[] terms = unlinked.stream().map(PharmacyMedicine::getName).distinct().toArray(String[]::new);
            for (var row : medicineRepository.findSimilarByNames(terms, SUGGESTIONS_PER_ITEM)) {
                suggestionsByName.computeIfAbsent(row.getTerm(), k -> new java.util.ArrayList<>())
                        .add(new PendingLocalMedicineResponse.Suggestion(row.getId(), row.getName(),
                                row.getGenericName(), row.getStrength(), row.getForm(), row.getSimilarity()));
            }
        }

        // Ambiguous — recomputed live against the current catalogue (see MedicineMatcher),
        // not persisted: a since-resolved catalogue duplicate stops flagging on its own.
        Set<String> ambiguousNames = Set.of();
        if (!unlinked.isEmpty()) {
            Set<String> lowerNames = unlinked.stream().map(PharmacyMedicine::getName)
                    .map(MedicineMatcher::normalize).collect(java.util.stream.Collectors.toSet());
            Set<String> lowerGenerics = unlinked.stream().map(PharmacyMedicine::getGenericName)
                    .filter(java.util.Objects::nonNull).filter(s -> !s.isBlank())
                    .map(MedicineMatcher::normalize).collect(java.util.stream.Collectors.toSet());
            List<Medicine> candidates = medicineRepository.findActiveForEmrMatch(
                    lowerNames.isEmpty() ? Set.of("__no_name__") : lowerNames,
                    lowerGenerics.isEmpty() ? Set.of("__no_generic__") : lowerGenerics);
            ambiguousNames = unlinked.stream()
                    .filter(m -> MedicineMatcher.match(new AmbiguityCheckInput(m), Map.of(), candidates)
                            .strategy().startsWith("AMBIGUOUS"))
                    .map(PharmacyMedicine::getName).collect(java.util.stream.Collectors.toSet());
        }

        // Linked-medicine display names, one batched lookup.
        List<String> linkedIds = all.stream().map(PharmacyMedicine::getLinkedMedicineId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, String> linkedNameById = new HashMap<>();
        if (!linkedIds.isEmpty()) {
            for (Medicine med : medicineRepository.findAllById(linkedIds)) {
                linkedNameById.put(med.getId(), med.getName());
            }
        }

        Set<String> ambiguousNamesFinal = ambiguousNames;
        return all.stream().map(m -> new LocalMedicineResponse(m.getId(), m.getName(), m.getManufacturer(),
                m.getGenericName(), m.getStrength(), m.getForm(), m.getHsnCode(), m.getGstRate(),
                m.getMatchStatus().name(), m.getLinkedMedicineId(),
                m.getLinkedMedicineId() == null ? null : linkedNameById.get(m.getLinkedMedicineId()),
                ambiguousNamesFinal.contains(m.getName()), m.getCreatedAt(),
                suggestionsByName.getOrDefault(m.getName(), List.of()))).toList();
    }

    private static PharmacyMedicineResponse toResponse(PharmacyMedicine m) {
        return new PharmacyMedicineResponse(m.getId(), m.getName(), m.getManufacturer(), m.getGenericName(),
                m.getStrength(), m.getForm(), m.getUnit(), m.getHsnCode(), m.getGstRate(), m.getSchedule(),
                m.getMatchStatus().name(), m.getLinkedMedicineId());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** A local medicine never carries a known global id — EXACT_ID is never reachable, by construction. */
    private record AmbiguityCheckInput(PharmacyMedicine row) implements MedicineMatcher.MatchInput {
        @Override public String medicineId() { return null; }
        @Override public String name() { return row.getName(); }
        @Override public String genericName() { return row.getGenericName(); }
        @Override public String strength() { return row.getStrength(); }
        @Override public String form() { return row.getForm(); }
    }
}
