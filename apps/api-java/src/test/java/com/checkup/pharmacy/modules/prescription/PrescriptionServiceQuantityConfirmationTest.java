package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionResponse;
import com.checkup.pharmacy.modules.upload.UploadRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A line the clinic sent with no usable quantity ("as directed") is ingested as a
 * {@code quantity == 0} placeholder rather than rejected — see
 * {@code PrescriptionItem.needsQuantityConfirmation}. This covers the pharmacist-facing side
 * of fixing that: it must show up in {@code needsReview} the same way an unmatched medicine
 * already does, and {@code confirmItemQuantity} is the only door that resolves it.
 */
class PrescriptionServiceQuantityConfirmationTest {

    private final PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
    private final PrescriptionItemRepository itemRepository = mock(PrescriptionItemRepository.class);
    private final DoctorRepository doctorRepository = mock(DoctorRepository.class);
    private final UploadRepository uploadRepository = mock(UploadRepository.class);
    private final MedicineRepository medicineRepository = mock(MedicineRepository.class);
    private final DocumentSequenceService sequenceService = mock(DocumentSequenceService.class);
    private final ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);

    private final PrescriptionService service = new PrescriptionService(prescriptionRepository, itemRepository,
            doctorRepository, uploadRepository, medicineRepository, sequenceService, eventPublisher);

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
    @DisplayName("an unconfirmed-quantity line counts toward needsReview, same as an unmatched medicine")
    void unconfirmedQuantityCountsTowardNeedsReview() {
        Prescription rx = prescription();
        PrescriptionItem matchedButUnconfirmed = PrescriptionItem.createFromEmr("ph_1", rx.getId(), "item-1",
                "Paracetamol", "med_1", null, 0, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(matchedButUnconfirmed));

        PrescriptionResponse response = service.getById(rx.getId());

        assertThat(response.needsReview()).isEqualTo(1);
    }

    @Test
    @DisplayName("a line needing BOTH a medicine link and a quantity still counts once, not twice")
    void aLineNeedingBothCountsOnlyOnce() {
        Prescription rx = prescription();
        PrescriptionItem needsBoth = PrescriptionItem.createFromEmr("ph_1", rx.getId(), "item-1",
                "Some Unknown Drug", null, null, 0, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(needsBoth));

        PrescriptionResponse response = service.getById(rx.getId());

        assertThat(response.needsReview()).isEqualTo(1);
    }

    @Test
    @DisplayName("confirming a quantity sets it on the item and persists")
    void confirmItemQuantitySetsAndSaves() {
        Prescription rx = prescription();
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", rx.getId(), "item-1",
                "Paracetamol", "med_1", null, 0, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(item));

        PrescriptionResponse response = service.confirmItemQuantity(rx.getId(), item.getId(), 7);

        assertThat(item.getQuantity()).isEqualTo(7);
        assertThat(response.needsReview()).isZero();
        org.mockito.Mockito.verify(itemRepository).save(item);
    }

    @Test
    @DisplayName("confirming a quantity on a line that already has one is rejected, not silently overwritten")
    void confirmingAnAlreadyConfirmedLineIsRejected() {
        Prescription rx = prescription();
        PrescriptionItem item = PrescriptionItem.create("ph_1", rx.getId(), "Paracetamol", "med_1",
                null, 10, null, null, null);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(item));

        assertThatThrownBy(() -> service.confirmItemQuantity(rx.getId(), item.getId(), 20))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("already confirmed");
        assertThat(item.getQuantity()).isEqualTo(10);
    }

    @Test
    @DisplayName("confirming below what was already dispensed against the line is rejected")
    void confirmingBelowAlreadyDispensedIsRejected() {
        Prescription rx = prescription();
        PrescriptionItem item = PrescriptionItem.createFromEmr("ph_1", rx.getId(), "item-1",
                "Paracetamol", "med_1", null, 0, null, null, null);
        item.recordDispensed(4);
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of(item));

        assertThatThrownBy(() -> service.confirmItemQuantity(rx.getId(), item.getId(), 2))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("already dispensed");
    }

    @Test
    @DisplayName("confirming a quantity on an unknown prescription line is a plain not-found")
    void confirmingAnUnknownLineIsNotFound() {
        Prescription rx = prescription();
        when(prescriptionRepository.findByIdAndPharmacyId(rx.getId(), "ph_1")).thenReturn(Optional.of(rx));
        when(itemRepository.findByPrescriptionId(rx.getId())).thenReturn(List.of());

        assertThatThrownBy(() -> service.confirmItemQuantity(rx.getId(), "missing-item", 5))
                .isInstanceOf(NotFoundException.class);
    }

    private static Prescription prescription() {
        return Prescription.create("ph_1", "RX-000001", null, "Dr. Rao", null, null,
                "Asha Verma", null, null, null, null, null, null, null);
    }
}
