package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Tries to link a pharmacy-local medicine (see {@link PharmacyMedicine}) to the
 * global catalogue, in the background, after a GRN that received it has already
 * completed. Never blocks GRN completion and never rewrites any existing GRN
 * item, batch, or invoice line — only ever updates the {@code PharmacyMedicine}
 * row itself.
 *
 * <p>Reuses the same tiered exact matcher proven for EMR/Rx ingestion
 * ({@link MedicineMatcher} — EXACT_NAME, then GENERIC_STRENGTH_FORM). A
 * deterministic hit auto-links. Anything else falls back to the fuzzy trigram
 * suggester ({@link MedicineRepository#findSimilarByNames}) — but a fuzzy hit is
 * only ever recorded as {@link MedicineMatchStatus#SUGGESTED}, never auto-linked:
 * the cost of a plausible-but-wrong drug match is a dispensing error, so a human
 * always confirms it (see the pending-review endpoint).
 */
@Service
public class GrnMedicineMatchService {

    /** How stale a still-PENDING row must be before the scheduled backstop retries it. */
    private static final Duration BACKSTOP_AGE = Duration.ofMinutes(5);

    private final PharmacyMedicineRepository pharmacyMedicineRepository;
    private final MedicineRepository medicineRepository;

    public GrnMedicineMatchService(PharmacyMedicineRepository pharmacyMedicineRepository,
                                   MedicineRepository medicineRepository) {
        this.pharmacyMedicineRepository = pharmacyMedicineRepository;
        this.medicineRepository = medicineRepository;
    }

    /**
     * Called from {@link GrnMedicineMatchListener} right after a GRN commits. Tenant-scoped
     * at the query itself (findByIdInAndPharmacyId) — this runs on a background thread with
     * no request/tenant context, so nothing here can fall back on that the way a request
     * thread could; see UnscopedFinderCallGuardTest.
     */
    @Transactional
    public void matchIds(String pharmacyId, Collection<String> pharmacyMedicineIds) {
        List<PharmacyMedicine> rows = pharmacyMedicineRepository.findByIdInAndPharmacyId(pharmacyMedicineIds, pharmacyId).stream()
                .filter(m -> m.getMatchStatus() == MedicineMatchStatus.PENDING)
                .toList();
        matchRows(rows);
    }

    /** Called from the scheduled backstop sweep, one pharmacy at a time — see {@code GrnMedicineMatchRetryJob}. */
    @Transactional
    public int retryStaleForPharmacy(String pharmacyId) {
        List<PharmacyMedicine> rows = pharmacyMedicineRepository.findByPharmacyIdAndMatchStatusAndCreatedAtBefore(
                pharmacyId, MedicineMatchStatus.PENDING, Instant.now().minus(BACKSTOP_AGE));
        matchRows(rows);
        return rows.size();
    }

    private void matchRows(List<PharmacyMedicine> rows) {
        if (rows.isEmpty()) {
            return;
        }
        Set<String> lowerNames = rows.stream().map(PharmacyMedicine::getName)
                .map(MedicineMatcher::normalize).collect(Collectors.toSet());
        Set<String> lowerGenerics = rows.stream().map(PharmacyMedicine::getGenericName)
                .filter(Objects::nonNull).filter(s -> !s.isBlank())
                .map(MedicineMatcher::normalize).collect(Collectors.toSet());
        // Hibernate/Postgres do not portably accept an empty IN collection.
        List<Medicine> candidates = medicineRepository.findActiveForEmrMatch(
                lowerNames.isEmpty() ? Set.of("__no_name__") : lowerNames,
                lowerGenerics.isEmpty() ? Set.of("__no_generic__") : lowerGenerics);

        List<PharmacyMedicine> unresolved = new ArrayList<>();
        for (PharmacyMedicine row : rows) {
            Medicine matched = MedicineMatcher.match(new MatchInput(row), Map.of(), candidates).medicine();
            if (matched != null) {
                row.linkTo(matched.getId());
            } else {
                unresolved.add(row);
            }
        }

        if (!unresolved.isEmpty()) {
            String[] terms = unresolved.stream().map(PharmacyMedicine::getName).toArray(String[]::new);
            Set<String> hasSuggestion = medicineRepository.findSimilarByNames(terms, 1).stream()
                    .map(MedicineRepository.SimilarNameRow::getTerm).collect(Collectors.toSet());
            for (PharmacyMedicine row : unresolved) {
                if (hasSuggestion.contains(row.getName())) {
                    row.markSuggested();
                } else {
                    row.keepLocal();
                }
            }
        }

        pharmacyMedicineRepository.saveAll(rows);
    }

    /** A local medicine never carries a known global id — EXACT_ID is never reachable, by construction. */
    private record MatchInput(PharmacyMedicine row) implements MedicineMatcher.MatchInput {
        @Override public String medicineId() { return null; }
        @Override public String name() { return row.getName(); }
        @Override public String genericName() { return row.getGenericName(); }
        @Override public String strength() { return row.getStrength(); }
        @Override public String form() { return row.getForm(); }
    }
}
