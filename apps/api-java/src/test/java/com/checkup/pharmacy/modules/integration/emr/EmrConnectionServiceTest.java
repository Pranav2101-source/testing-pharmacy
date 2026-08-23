package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.integration.emr.dto.SaveEmrClinicRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.EmrSecretCipher;
import com.checkup.pharmacy.security.UserPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@code saveClinic} (the manual "Connect manually" form's PUT) must never be reachable on an
 * already-paired connection. Pairing binds {@code emrCallbackUrl} to the CLINIC's own webhook
 * secret; this method only ever touches the URL. Letting it through on a paired pharmacy would
 * retarget where callbacks are sent while they keep signing with the original clinic's key — a
 * failure indistinguishable from "the clinic's server is down". The frontend already never
 * exposes this form once connected (see ClinicConnectionPanel — the manual form only renders
 * in the disconnected state), so this is the backend-side safety net for a direct API call.
 */
class EmrConnectionServiceTest {

    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
    private final EmrSecretCipher secretCipher =
            new EmrSecretCipher("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    private final AuditService auditService = mock(AuditService.class);

    private final EmrConnectionService service = new EmrConnectionService(pharmacyRepository,
            prescriptionRepository, secretCipher, auditService, "https://rainbow.checkup.care");

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
    @DisplayName("saving clinic details on an already-paired pharmacy is rejected, not silently applied")
    void savingOnAPairedPharmacyIsRejected() {
        Pharmacy pharmacy = Pharmacy.create("Rainbow Pharmacy", "rainbow");
        pharmacy.pairEmrClinic("clinic-1", "Apollo", "https://apollo.example/webhook",
                "lnk_1", "pk_live", "hash-not-used-here");
        when(pharmacyRepository.findById("ph_1")).thenReturn(Optional.of(pharmacy));

        var request = new SaveEmrClinicRequest("Some Other Clinic", "https://someone-else.example/webhook");

        assertThatThrownBy(() -> service.saveClinic(request))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("pairing");
        verify(pharmacyRepository, never()).save(any());
        // The URL that was actually paired must survive the rejected attempt untouched.
        org.assertj.core.api.Assertions.assertThat(pharmacy.getEmrCallbackUrl())
                .isEqualTo("https://apollo.example/webhook");
    }

    @Test
    @DisplayName("saving clinic details on an unpaired (manual) pharmacy still works")
    void savingOnAnUnpairedPharmacyStillWorks() {
        Pharmacy pharmacy = Pharmacy.create("Rainbow Pharmacy", "rainbow");
        when(pharmacyRepository.findById("ph_1")).thenReturn(Optional.of(pharmacy));
        when(prescriptionRepository.countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNull(any())).thenReturn(0L);
        when(prescriptionRepository.findLastEmrPrescriptionAt(any())).thenReturn(null);
        when(prescriptionRepository.countByPharmacyIdAndDispenseNotifyStatus(any(), any())).thenReturn(0L);

        var request = new SaveEmrClinicRequest("Manual Clinic", "https://manual.example/webhook");
        var status = service.saveClinic(request);

        org.assertj.core.api.Assertions.assertThat(status.callbackUrl()).isEqualTo("https://manual.example/webhook");
        verify(pharmacyRepository).save(pharmacy);
    }
}
