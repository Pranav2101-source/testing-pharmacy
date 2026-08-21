package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionResponse;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.upload.UploadRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Suggestions are a convenience layered on top of ingest — see
 * {@code PrescriptionResponse.Suggestion}: never applied automatically, and never computed
 * for a line that already has a medicine. The batching itself (one query per PAGE, not per
 * line) can only be proven against real Postgres — see {@code MedicineSimilarNameIT} — so
 * this covers the half that is pure Java: what gets asked for, and how results are matched
 * back to the item that asked.
 */
class PrescriptionServiceSuggestionsTest {

    private final PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
    private final PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
    private final DoctorRepository doctorRepository = mock(DoctorRepository.class);
    private final UploadRepository uploadRepository = mock(UploadRepository.class);
    private final MedicineRepository medicineRepository = mock(MedicineRepository.class);
    private final DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);

    private final PrescriptionService service = new PrescriptionService(prescriptionRepository, itemRepository,
            doctorRepository, uploadRepository, medicineRepository, sequenceService);

    @BeforeEach
    void tenant() {
        var principal = new UserPrincipal("user-1", "ph_1", Role.OWNER, "owner@pharmacy.test");
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
    }

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("a matched line never asks for suggestions at all")
    void matchedLinesAreNeverQueried() {
        Prescription rx = prescription();
        PrescriptionItem matched = PrescriptionItem.create("ph_1", rx.getId(), "Dolo 650 Tablet",
                "med_1", null, 10, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(matched));

        PrescriptionResponse response = service.getById(rx.getId());

        assertThat(response.items().get(0).suggestions()).isEmpty();
        verify(medicineRepository, never()).findSimilarByNames(any(), any(Integer.class));
    }

    @Test
    @DisplayName("an unmatched line's suggestions are wired from the batched query result")
    void unmatchedLineGetsItsSuggestions() {
        Prescription rx = prescription();
        PrescriptionItem unmatched = PrescriptionItem.create("ph_1", rx.getId(), "Dolo 650",
                null, null, 10, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(unmatched));
        // Built BEFORE the stub that returns it: row() does its own mock()+when() setup,
        // and nesting that inside this stub's own thenReturn(...) argument corrupts
        // Mockito's "awaiting a stub" tracking — see hint #3 on UnfinishedStubbingException.
        MedicineRepository.SimilarNameRow dolo650 = row("dolo 650", "med_9", "Dolo 650 Tablet", 0.78);
        when(medicineRepository.findSimilarByNames(eq(new String[]{"dolo 650"}), eq(3)))
                .thenReturn(List.of(dolo650));

        PrescriptionResponse response = service.getById(rx.getId());

        List<PrescriptionResponse.Suggestion> suggestions = response.items().get(0).suggestions();
        assertThat(suggestions).hasSize(1);
        assertThat(suggestions.get(0).medicineId()).isEqualTo("med_9");
        assertThat(suggestions.get(0).name()).isEqualTo("Dolo 650 Tablet");
    }

    @Test
    @DisplayName("two lines with the same unmatched name query the catalogue once, not twice")
    void repeatedNameIsDeduplicatedIntoOneTerm() {
        Prescription rx = prescription();
        PrescriptionItem lineA = PrescriptionItem.create("ph_1", rx.getId(), "Dolo 650",
                null, null, 10, null, null, null);
        PrescriptionItem lineB = PrescriptionItem.create("ph_1", rx.getId(), "Dolo 650",
                null, null, 20, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(lineA, lineB));
        MedicineRepository.SimilarNameRow dolo650 = row("dolo 650", "med_9", "Dolo 650 Tablet", 0.78);
        when(medicineRepository.findSimilarByNames(any(), eq(3)))
                .thenReturn(List.of(dolo650));

        PrescriptionResponse response = service.getById(rx.getId());

        // One call, and BOTH lines see the result — not just whichever happened to match
        // the exact object identity of the query term.
        verify(medicineRepository).findSimilarByNames(eq(new String[]{"dolo 650"}), eq(3));
        assertThat(response.items()).allSatisfy(item ->
                assertThat(item.suggestions()).extracting(PrescriptionResponse.Suggestion::medicineId)
                        .containsExactly("med_9"));
    }

    @Test
    @DisplayName("no unmatched lines means no query at all")
    void noUnmatchedLinesSkipsTheQueryEntirely() {
        Prescription rx = prescription();
        PrescriptionItem matched = PrescriptionItem.create("ph_1", rx.getId(), "Dolo 650 Tablet",
                "med_1", null, 10, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(matched));

        service.getById(rx.getId());

        verify(medicineRepository, never()).findSimilarByNames(any(), any(Integer.class));
    }

    @Test
    @DisplayName("a term with no candidate above the floor leaves that line's suggestions empty, not null")
    void unmatchedTermWithNoCandidatesYieldsEmptyNotNull() {
        Prescription rx = prescription();
        PrescriptionItem unmatched = PrescriptionItem.create("ph_1", rx.getId(), "Completely Unknown Drug",
                null, null, 10, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(unmatched));
        when(medicineRepository.findSimilarByNames(any(), eq(3))).thenReturn(List.of());

        PrescriptionResponse response = service.getById(rx.getId());

        assertThat(response.items().get(0).suggestions()).isNotNull().isEmpty();
    }

    private static Prescription prescription() {
        return Prescription.create("ph_1", "RX-000001", null, "Dr. Rao", null, null,
                "Asha Verma", null, null, null, null, null, null, null);
    }

    private static MedicineRepository.SimilarNameRow row(String term, String id, String name, double similarity) {
        MedicineRepository.SimilarNameRow row = mock(MedicineRepository.SimilarNameRow.class);
        when(row.getTerm()).thenReturn(term);
        when(row.getId()).thenReturn(id);
        when(row.getName()).thenReturn(name);
        when(row.getGenericName()).thenReturn(null);
        when(row.getStrength()).thenReturn(null);
        when(row.getForm()).thenReturn(null);
        when(row.getSimilarity()).thenReturn(similarity);
        return row;
    }
}
