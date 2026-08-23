package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicPairRequest;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicPairResponse;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.common.enums.TenantStatus;
import com.checkup.pharmacy.security.ApiSecretHasher;
import com.checkup.pharmacy.security.EmrSecretCipher;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("Clinic pairing: one exchange establishes the whole link")
class ClinicPairingServiceTest {

    /** A real cipher — the encrypt/decrypt round trip is part of what pairing has to get right. */
    private static final EmrSecretCipher CIPHER =
            new EmrSecretCipher("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

    private final PharmacyRepository pharmacyRepository = mock(PharmacyRepository.class);
    private final AuditService auditService = mock(AuditService.class);
    private final ClinicPairingService service =
            new ClinicPairingService(pharmacyRepository, CIPHER, auditService);

    private static final String CODE = "the-generated-pairing-code";

    @Test
    @DisplayName("a valid code links the clinic and returns a credential")
    void pairsSuccessfully() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ClinicPairResponse response = service.pair(request(CODE, "https://clinic.example"));

        assertThat(response.apiKey()).startsWith("pk_");
        assertThat(response.apiSecret()).isNotBlank();
        assertThat(response.clinicLinkId()).startsWith("lnk_");
        assertThat(response.pharmacyId()).isEqualTo(pharmacy.getId());
        assertThat(response.pharmacyName()).isEqualTo("Test Pharmacy");

        assertThat(pharmacy.isEmrPaired()).isTrue();
        assertThat(pharmacy.getEmrClinicExternalId()).isEqualTo("clinic-apollo-01");
        assertThat(pharmacy.getEmrClinicName()).isEqualTo("Apollo Clinic");
        assertThat(pharmacy.getEmrPairedAt()).isNotNull();
    }

    @Test
    @DisplayName("the secret is stored hashed, never in the clear")
    void storesOnlyAHashOfTheSecret() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ClinicPairResponse response = service.pair(request(CODE, "https://clinic.example"));

        assertThat(pharmacy.getEmrApiSecretHash()).isNotEqualTo(response.apiSecret());
        assertThat(pharmacy.getEmrApiSecretHash())
                .isEqualTo(ApiSecretHasher.hash(response.apiSecret()));
        assertThat(ApiSecretHasher.matches(response.apiSecret(), pharmacy.getEmrApiSecretHash()))
                .isTrue();
    }

    @Test
    @DisplayName("the callback path is appended, so nobody has to be told a URL")
    void composesTheCallbackUrl() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.pair(request(CODE, "https://clinic.example"));

        assertThat(pharmacy.getEmrCallbackUrl())
                .isEqualTo("https://clinic.example" + ClinicPairingService.CLINIC_CALLBACK_PATH);
    }

    @Test
    @DisplayName("a trailing slash on the clinic address does not produce a doubled slash")
    void normalisesTrailingSlashes() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.pair(request(CODE, "https://clinic.example///"));

        assertThat(pharmacy.getEmrCallbackUrl())
                .isEqualTo("https://clinic.example" + ClinicPairingService.CLINIC_CALLBACK_PATH);
        assertThat(pharmacy.getEmrCallbackUrl()).doesNotContain("//api");
    }

    @Test
    @DisplayName("the clinic's webhook secret round-trips through encryption")
    void storesTheWebhookSecretEncrypted() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.pair(request(CODE, "https://clinic.example"));

        assertThat(pharmacy.getEmrWebhookSecretCiphertext()).isNotNull();
        assertThat(pharmacy.getEmrWebhookSecretCiphertext()).isNotEqualTo("clinic-webhook-secret");
        assertThat(CIPHER.decrypt(pharmacy.getEmrWebhookSecretCiphertext(),
                pharmacy.getEmrWebhookSecretIv(), pharmacy.getEmrWebhookSecretTag()))
                .isEqualTo("clinic-webhook-secret");
        // Holding the clinic's secret is what marks this link as speaking the clinic's
        // callback dialect — see Pharmacy.usesClinicCallbackDialect.
        assertThat(pharmacy.usesClinicCallbackDialect()).isTrue();
    }

    @Test
    @DisplayName("a wrong code is refused")
    void rejectsAWrongCode() {
        stubHashLookup(CODE, pharmacyWithCode(CODE));

        assertThatThrownBy(() -> service.pair(request("not-the-code", "https://clinic.example")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("not valid");
    }

    @Test
    @DisplayName("a pharmacy that never generated a code cannot be paired")
    void rejectsAPharmacyWithNoCode() {
        // No stub needed: a pharmacy with no ciphertext at all is never returned by either
        // real query (findByEmrSecretLookupHash — nothing was ever hashed for it — or the
        // fallback scan, which requires a non-null ciphertext), so the default Mockito
        // answers (empty Optional, empty List) already represent this case correctly.
        assertThatThrownBy(() -> service.pair(request(CODE, "https://clinic.example")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("an inactive pharmacy cannot be paired, even with the right code")
    void rejectsAnInactivePharmacy() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        pharmacy.applyStatus(TenantStatus.SUSPENDED, false);
        stubHashLookup(CODE, pharmacy);

        assertThatThrownBy(() -> service.pair(request(CODE, "https://clinic.example")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("a clinic address that is not an absolute http(s) URL is refused")
    void rejectsABadClinicAddress() {
        stubHashLookup(CODE, pharmacyWithCode(CODE));

        assertThatThrownBy(() -> service.pair(request(CODE, "clinic.example")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("full http(s) URL");
        assertThatThrownBy(() -> service.pair(request(CODE, "ftp://clinic.example")))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("re-pairing replaces the credential — the recovery path for a lost secret")
    void rePairingIssuesAFreshCredential() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ClinicPairResponse first = service.pair(request(CODE, "https://clinic.example"));
        ClinicPairResponse second = service.pair(request(CODE, "https://clinic.example"));

        assertThat(second.apiKey()).isNotEqualTo(first.apiKey());
        assertThat(second.apiSecret()).isNotEqualTo(first.apiSecret());
        // Only the newest credential is live: the old secret no longer matches what is stored.
        assertThat(ApiSecretHasher.matches(first.apiSecret(), pharmacy.getEmrApiSecretHash()))
                .isFalse();
        assertThat(ApiSecretHasher.matches(second.apiSecret(), pharmacy.getEmrApiSecretHash()))
                .isTrue();
    }

    @Test
    @DisplayName("disconnecting revokes the API credential too, not just the address")
    void disconnectRevokesEverything() {
        // Regression guard. An earlier audit of this module found unlinking a clinic
        // revoked the LINK but not its credential, leaving a connection that read as
        // "disconnected" on screen while still accepting pushes.
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service.pair(request(CODE, "https://clinic.example"));
        assertThat(pharmacy.isEmrPaired()).isTrue();

        pharmacy.disconnectEmrClinic();

        assertThat(pharmacy.isEmrPaired()).isFalse();
        assertThat(pharmacy.getEmrApiKey()).isNull();
        assertThat(pharmacy.getEmrApiSecretHash()).isNull();
        assertThat(pharmacy.usesClinicCallbackDialect()).isFalse();
        assertThat(pharmacy.getEmrClinicExternalId()).isNull();
        assertThat(pharmacy.getEmrClinicLinkId()).isNull();
        assertThat(pharmacy.getEmrCallbackUrl()).isNull();
        assertThat(pharmacy.getEmrSecretCiphertext()).isNull();
        assertThat(pharmacy.getEmrSecretLookupHash()).isNull();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The indexed lookup and its fallback. Every test above exercises a pharmacy
    // shaped exactly like generateKey() produces one today (hash set alongside the
    // ciphertext) — these cover the other half: the fast path is actually used
    // instead of the old scan, and a pharmacy whose key predates the hash column
    // can still be paired.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a hash-lookup hit never falls through to the old decrypt-scan fallback")
    void fastPathNeverTouchesTheFallbackScan() {
        Pharmacy pharmacy = pharmacyWithCode(CODE);
        stubHashLookup(CODE, pharmacy);
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.pair(request(CODE, "https://clinic.example"));

        verify(pharmacyRepository, never()).findAllByEmrSecretLookupHashIsNullAndEmrSecretCiphertextIsNotNull();
    }

    @Test
    @DisplayName("a pharmacy whose key predates the lookup-hash column is still found, via the fallback scan")
    void fallsBackToTheOldScanForAPharmacyWithNoLookupHashYet() {
        // Built the way pairEmrClinic/generateKey used to, before this column existed:
        // ciphertext present, lookup hash absent. findByEmrSecretLookupHash has nothing to
        // find this by, so pairing must still fall through to the decrypt scan — scoped to
        // exactly this (shrinking) population, not the whole pharmacy table.
        Pharmacy legacy = Pharmacy.create("Legacy Pharmacy", "legacy-pharmacy");
        EmrSecretCipher.Encrypted encrypted = CIPHER.encrypt(CODE);
        legacy.setEmrSecret(encrypted.ciphertext(), encrypted.iv(), encrypted.tag(), null);
        when(pharmacyRepository.findAllByEmrSecretLookupHashIsNullAndEmrSecretCiphertextIsNotNull())
                .thenReturn(List.of(legacy));
        when(pharmacyRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ClinicPairResponse response = service.pair(request(CODE, "https://clinic.example"));

        assertThat(response.pharmacyId()).isEqualTo(legacy.getId());
        assertThat(legacy.isEmrPaired()).isTrue();
    }

    @Test
    @DisplayName("pairing fails closed when at-rest encryption is not configured")
    void refusesWithoutAnEncryptionKey() {
        ClinicPairingService unconfigured = new ClinicPairingService(
                pharmacyRepository, new EmrSecretCipher(""), auditService);

        assertThatThrownBy(() -> unconfigured.pair(request(CODE, "https://clinic.example")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("not available");
    }

    private static ClinicPairRequest request(String code, String baseUrl) {
        return new ClinicPairRequest(code, "clinic-apollo-01", "Apollo Clinic", baseUrl,
                "clinic-webhook-secret");
    }

    /** Shaped exactly like a pharmacy generateKey() produces today: hash set alongside the ciphertext. */
    private static Pharmacy pharmacyWithCode(String code) {
        Pharmacy pharmacy = Pharmacy.create("Test Pharmacy", "test-pharmacy");
        EmrSecretCipher.Encrypted encrypted = CIPHER.encrypt(code);
        pharmacy.setEmrSecret(encrypted.ciphertext(), encrypted.iv(), encrypted.tag(), ApiSecretHasher.hash(code));
        return pharmacy;
    }

    /** Stubs the indexed hash lookup every current-generation pharmacy is found through. */
    private void stubHashLookup(String code, Pharmacy pharmacy) {
        when(pharmacyRepository.findByEmrSecretLookupHash(ApiSecretHasher.hash(code)))
                .thenReturn(Optional.of(pharmacy));
    }
}
