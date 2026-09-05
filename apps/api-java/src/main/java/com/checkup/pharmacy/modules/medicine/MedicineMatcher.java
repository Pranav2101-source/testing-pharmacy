package com.checkup.pharmacy.modules.medicine;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The tiered exact-match strategy shared by EMR prescription matching
 * ({@code EmrIntegrationService}) and GRN local-medicine background matching. Extracted
 * so a second caller doesn't fork the algorithm — this class has no DB/Spring
 * coupling, callers supply their own candidate lists.
 *
 * <p>Deliberately exact-only: EXACT_ID, then EXACT_NAME, then GENERIC_STRENGTH_FORM,
 * with an AMBIGUOUS_* result when more than one candidate ties. Nothing here ever
 * returns a fuzzy/similarity-based match — that is a separate, always
 * human-confirmed step (see {@code MedicineRepository#findSimilarByNames}), never
 * auto-linked, because the cost of a plausible-but-wrong drug match is a dispensing
 * error.
 */
public final class MedicineMatcher {

    private MedicineMatcher() {
    }

    /** Whatever the caller is trying to match — an EMR request item, a local GRN medicine, etc. */
    public interface MatchInput {
        String medicineId();
        String name();
        String genericName();
        String strength();
        String form();
    }

    public record Match(String strategy, Medicine medicine) {
    }

    /**
     * Two candidates tying on the same name (or generic+strength+form) is a different
     * problem from finding none at all — one is a duplicate in this pharmacy's own
     * catalogue, the other is a genuinely unknown product — so an AMBIGUOUS_* result
     * still resolves to no medicine (nothing here can safely pick between two
     * candidates on its own) but names the actual reason so a caller can show it
     * differently from a plain UNMATCHED.
     */
    public static Match match(MatchInput item, Map<String, Medicine> direct, List<Medicine> candidates) {
        if (item.medicineId() != null && direct.containsKey(item.medicineId())) {
            return new Match("EXACT_ID", direct.get(item.medicineId()));
        }
        List<Medicine> exactName = candidates.stream()
                .filter(m -> normalize(m.getName()).equals(normalize(item.name())))
                .filter(m -> compatible(m, item)).toList();
        if (exactName.size() == 1) return new Match("EXACT_NAME", exactName.getFirst());
        if (exactName.size() > 1) return new Match("AMBIGUOUS_NAME", null);

        if (item.genericName() != null && !item.genericName().isBlank()) {
            List<Medicine> exactGeneric = candidates.stream()
                    .filter(m -> normalize(m.getGenericName()).equals(normalize(item.genericName())))
                    .filter(m -> compatible(m, item)).toList();
            if (exactGeneric.size() == 1) return new Match("GENERIC_STRENGTH_FORM", exactGeneric.getFirst());
            if (exactGeneric.size() > 1) return new Match("AMBIGUOUS_GENERIC", null);
        }
        return new Match("UNMATCHED", null);
    }

    private static boolean compatible(Medicine medicine, MatchInput item) {
        return (item.strength() == null || item.strength().isBlank()
                || normalize(medicine.getStrength()).equals(normalize(item.strength())))
                && (item.form() == null || item.form().isBlank()
                || normalize(medicine.getForm()).equals(normalize(item.form())));
    }

    public static String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }
}
