package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link MedicineRepository#findSimilarByNames} — the batched trigram lookup behind the
 * "did you mean" suggestions on an unmatched EMR prescription line.
 *
 * <p>Runs against real Postgres deliberately: {@code %}, {@code similarity()} and the GIN
 * trigram indexes from {@code 20260818000001_medicine_catalogue_trgm_search} are all
 * Postgres-specific and untestable against H2. This is also the only place that proves the
 * query is even syntactically valid — a native {@code @Query} has no compile-time check.
 */
@Transactional
class MedicineSimilarNameIT extends AbstractPostgresIT {

    @Autowired private MedicineRepository medicineRepository;

    @Test
    @DisplayName("finds the close match, in one call, for several terms at once")
    void findsCloseMatchesForMultipleTermsInOneCall() {
        seed("Dolo 650 Tablet");
        seed("Crocin Advance Tablet");
        seed("Azithromycin 500mg Tablet");

        List<MedicineRepository.SimilarNameRow> rows = medicineRepository.findSimilarByNames(
                new String[]{"dolo 650", "crocin advance", "azithromycin 500"}, 3);

        Map<String, List<String>> byTerm = rows.stream()
                .collect(Collectors.groupingBy(MedicineRepository.SimilarNameRow::getTerm,
                        Collectors.mapping(MedicineRepository.SimilarNameRow::getName, Collectors.toList())));

        assertThat(byTerm.get("dolo 650")).contains("Dolo 650 Tablet");
        assertThat(byTerm.get("crocin advance")).contains("Crocin Advance Tablet");
        assertThat(byTerm.get("azithromycin 500")).contains("Azithromycin 500mg Tablet");
    }

    @Test
    @DisplayName("a term with nothing close returns nothing, rather than the least-bad option")
    void returnsNothingWhenNoCandidateClearsTheFloor() {
        seed("Dolo 650 Tablet");

        List<MedicineRepository.SimilarNameRow> rows = medicineRepository.findSimilarByNames(
                new String[]{"xyzabc completely unrelated term"}, 3);

        assertThat(rows).isEmpty();
    }

    @Test
    @DisplayName("an inactive medicine is never suggested, even when its name is the closest match")
    void excludesInactiveMedicines() {
        Medicine inactive = Medicine.create("Discontinued Dolo 650 Tablet", BigDecimal.valueOf(12));
        inactive.deactivate();
        medicineRepository.save(inactive);

        List<MedicineRepository.SimilarNameRow> rows = medicineRepository.findSimilarByNames(
                new String[]{"dolo 650"}, 3);

        assertThat(rows).noneMatch(r -> r.getId().equals(inactive.getId()));
    }

    @Test
    @DisplayName("respects the per-term limit even when more candidates clear the floor")
    void respectsThePerTermLimit() {
        seed("Amlokind 5 Tablet");
        seed("Amlokind 2.5 Tablet");
        seed("Amlokind-AT Tablet");
        seed("Amlokind-CH Tablet");
        seed("Amlokind-H Tablet");

        List<MedicineRepository.SimilarNameRow> rows = medicineRepository.findSimilarByNames(
                new String[]{"amlokind"}, 2);

        assertThat(rows).hasSize(2);
    }

    @Test
    @DisplayName("results are ordered closest-first")
    void ordersClosestFirst() {
        seed("Telma 40 Tablet");
        seed("Telma-AM H 40 Tablet");

        List<MedicineRepository.SimilarNameRow> rows = medicineRepository.findSimilarByNames(
                new String[]{"telma 40"}, 2);

        assertThat(rows).isSortedAccordingTo(
                (a, b) -> Double.compare(b.getSimilarity(), a.getSimilarity()));
    }

    private void seed(String name) {
        medicineRepository.save(Medicine.create(name, BigDecimal.valueOf(12)));
    }
}
