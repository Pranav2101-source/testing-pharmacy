package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.EmrSecretCipher;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Which of the two callback dialects a pharmacy gets is decided entirely by which secret
 * {@code resolveConnection} finds — never by a separate flag. This is the regression guard
 * on that: it is easy to imagine a future change that adds a boolean and lets it drift from
 * the secret it was meant to describe. These tests fail the moment that happens.
 */
@DisplayName("Dispense callback: dialect is derived from which secret is present, never a flag")
class EmrDispenseCallbackServiceDialectTest {

    private static final EmrSecretCipher CIPHER =
            new EmrSecretCipher("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

    private final PrescriptionRepository prescriptionRepository = mock(PrescriptionRepository.class);
    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final EmrDispenseCallbackService service = new EmrDispenseCallbackService(
            prescriptionRepository, pharmacyRepository, CIPHER, new ObjectMapper(),
            "https://legacy-fallback.example/callback", 3000, 8000);

    @Test
    @DisplayName("a pharmacy connected the manual way (own HMAC secret) gets CHECKUP_HMAC")
    void manualConnectionUsesCheckupHmac() {
        Pharmacy pharmacy = Pharmacy.create("Manual Pharmacy", "manual");
        EmrSecretCipher.Encrypted own = CIPHER.encrypt("own-hmac-secret");
        pharmacy.setEmrSecret(own.ciphertext(), own.iv(), own.tag(), null);
        pharmacy.connectEmrClinic("Apollo", "https://apollo.example/webhook");
        when(pharmacyRepository.findById("ph_1")).thenReturn(Optional.of(pharmacy));

        var connection = service.resolveConnection("ph_1");

        assertThat(connection.dialect())
                .isEqualTo(EmrDispenseCallbackService.Connection.Dialect.CHECKUP_HMAC);
        assertThat(connection.secret()).isEqualTo("own-hmac-secret");
        assertThat(connection.callbackUrl()).isEqualTo("https://apollo.example/webhook");
    }

    @Test
    @DisplayName("a pharmacy paired through the compat surface gets LEGACY_WEBHOOK, signed with the CLINIC's secret")
    void pairedConnectionUsesLegacyWebhookAndTheClinicsOwnSecret() {
        Pharmacy pharmacy = Pharmacy.create("Paired Pharmacy", "paired");
        EmrSecretCipher.Encrypted clinicSecret = CIPHER.encrypt("clinic-webhook-secret");
        pharmacy.pairEmrClinic("clinic-1", "Apollo", "https://apollo.example/webhook",
                "lnk_1", "pk_live", "hash-not-used-here");
        pharmacy.setEmrWebhookSecret(clinicSecret.ciphertext(), clinicSecret.iv(), clinicSecret.tag());
        when(pharmacyRepository.findById("ph_2")).thenReturn(Optional.of(pharmacy));

        var connection = service.resolveConnection("ph_2");

        assertThat(connection.dialect())
                .isEqualTo(EmrDispenseCallbackService.Connection.Dialect.LEGACY_WEBHOOK);
        // The CLINIC's secret, not the pharmacy's own — that is the entire point of the
        // dialect switch, and the easiest place for a future edit to get it backwards.
        assertThat(connection.secret()).isEqualTo("clinic-webhook-secret");
    }

    @Test
    @DisplayName("a pharmacy with neither secret gets no connection to deliver on")
    void noSecretMeansNoUsableConnection() {
        Pharmacy pharmacy = Pharmacy.create("Bare Pharmacy", "bare");
        when(pharmacyRepository.findById("ph_3")).thenReturn(Optional.of(pharmacy));

        var connection = service.resolveConnection("ph_3");

        assertThat(connection.secret()).isNull();
        assertThat(connection.decryptionFailed())
                .as("never generated at all is a different case from generated-but-unreadable")
                .isFalse();
    }

    @Test
    @DisplayName("a secret that WAS generated but can no longer be decrypted is flagged distinctly from 'no secret'")
    void undecryptableSecretIsFlaggedDistinctlyFromNoSecret() {
        // A different cipher key than the one the service was built with — simulates
        // app.integration.emr.encryption-key changing after the secret was stored.
        EmrSecretCipher differentKeyCipher =
                new EmrSecretCipher("a".repeat(64));
        Pharmacy pharmacy = Pharmacy.create("Rekeyed Pharmacy", "rekeyed");
        EmrSecretCipher.Encrypted encryptedUnderOldKey = differentKeyCipher.encrypt("own-hmac-secret");
        pharmacy.setEmrSecret(encryptedUnderOldKey.ciphertext(), encryptedUnderOldKey.iv(),
                encryptedUnderOldKey.tag(), null);
        pharmacy.connectEmrClinic("Apollo", "https://apollo.example/webhook");
        when(pharmacyRepository.findById("ph_rekeyed")).thenReturn(Optional.of(pharmacy));

        var connection = service.resolveConnection("ph_rekeyed");

        assertThat(connection.secret()).isNull();
        assertThat(connection.decryptionFailed())
                .as("this pharmacist DID generate a key — the failure message must not say otherwise")
                .isTrue();
    }

    @Test
    @DisplayName("an inactive pharmacy resolves to no connection at all, regardless of secrets held")
    void inactivePharmacyResolvesToNull() {
        Pharmacy pharmacy = Pharmacy.create("Inactive Pharmacy", "inactive");
        EmrSecretCipher.Encrypted own = CIPHER.encrypt("own-hmac-secret");
        pharmacy.setEmrSecret(own.ciphertext(), own.iv(), own.tag(), null);
        pharmacy.applyStatus(com.checkup.pharmacy.common.enums.TenantStatus.SUSPENDED, false);
        when(pharmacyRepository.findById("ph_4")).thenReturn(Optional.of(pharmacy));

        assertThat(service.resolveConnection("ph_4")).isNull();
    }

    @Test
    @DisplayName("an unknown pharmacy resolves to no connection")
    void unknownPharmacyResolvesToNull() {
        when(pharmacyRepository.findById("ph_missing")).thenReturn(Optional.empty());

        assertThat(service.resolveConnection("ph_missing")).isNull();
    }
}
