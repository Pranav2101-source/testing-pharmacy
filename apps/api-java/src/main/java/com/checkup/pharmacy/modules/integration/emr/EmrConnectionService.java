package com.checkup.pharmacy.modules.integration.emr;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.audit.AuditEntry;
import com.checkup.pharmacy.modules.audit.AuditService;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrConnectionKeyResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrConnectionStatus;
import com.checkup.pharmacy.modules.integration.emr.dto.SaveEmrClinicRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.security.ApiSecretHasher;
import com.checkup.pharmacy.security.EmrSecretCipher;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URISyntaxException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;

/**
 * The pharmacy's own side of the clinic connection.
 *
 * <p>Everything here used to be a platform-admin errand: a pharmacy that wanted to
 * receive prescriptions from its clinic had to ask someone at Checkup to flip a
 * feature flag and read a generated secret back to them over the phone. The two
 * products' halves of one handshake sat behind two different doors. This is the
 * pharmacy's door — the mirror of the clinic's own "connect a pharmacy" screen.
 *
 * <p>Scoped to {@link TenantContext#pharmacyId()} throughout: a pharmacy can only
 * ever read or change its own connection.
 */
@Service
public class EmrConnectionService {

    private static final SecureRandom RNG = new SecureRandom();

    private final PharmacyRepository pharmacyRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final EmrSecretCipher secretCipher;
    private final AuditService auditService;
    private final String pharmacyBaseUrl;

    public EmrConnectionService(PharmacyRepository pharmacyRepository,
                                PrescriptionRepository prescriptionRepository,
                                EmrSecretCipher secretCipher,
                                AuditService auditService,
                                @Value("${app.integration.emr.pharmacy-base-url:}") String pharmacyBaseUrl) {
        this.pharmacyRepository = pharmacyRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.secretCipher = secretCipher;
        this.auditService = auditService;
        this.pharmacyBaseUrl = pharmacyBaseUrl == null ? "" : pharmacyBaseUrl.trim();
    }

    @Transactional(readOnly = true)
    public EmrConnectionStatus status() {
        return toStatus(load());
    }

    /**
     * Saves which clinic this pharmacy is connected to, and where its updates go.
     *
     * <p>Refuses on an already-paired pharmacy. Pairing binds {@code emrCallbackUrl} to the
     * CLINIC's own webhook secret ({@code emrWebhookSecret*} — see
     * {@code EmrDispenseCallbackService.resolveConnection}'s dialect selection); this method
     * only ever touches the callback URL, never that secret. Allowing it through would let a
     * pharmacist retarget a paired connection's delivery address while every future callback
     * keeps signing with the original clinic's key — a failure indistinguishable from "the
     * clinic's server is down" until someone thinks to compare the two. Disconnecting first
     * (which clears both together) and either re-pairing or connecting manually is the one
     * path that cannot desync them.
     */
    @Transactional
    public EmrConnectionStatus saveClinic(SaveEmrClinicRequest req) {
        Pharmacy p = load();
        if (p.isEmrPaired()) {
            throw new ConflictException(
                    "This pharmacy is connected via clinic pairing. Disconnect first if you need to change "
                            + "these details by hand.");
        }
        String previous = p.getEmrCallbackUrl();
        p.connectEmrClinic(req.clinicName().trim(), validateCallbackUrl(req.callbackUrl()));
        pharmacyRepository.save(p);

        auditService.log(AuditEntry.of(AuditModule.SETTINGS, "EMR_CLINIC_SAVED", "PHARMACY")
                .pharmacyId(p.getId()).userId(TenantContext.userId()).entityId(p.getId())
                .oldData(Map.of("callbackUrl", previous == null ? "" : previous))
                .newData(Map.of("callbackUrl", p.getEmrCallbackUrl(), "clinicName", p.getEmrClinicName())));

        return toStatus(p);
    }

    /**
     * Issues a fresh connection key and returns it once.
     *
     * <p>The plaintext is never stored and never returned again — the pharmacist
     * pastes it straight into their clinic's pharmacy-connection form. Generating a
     * new one immediately invalidates the old one, which is the point: it is also
     * the "someone saw our key" button.
     */
    @Transactional
    public EmrConnectionKeyResponse generateKey() {
        Pharmacy p = load();

        byte[] raw = new byte[32];
        RNG.nextBytes(raw);
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);

        EmrSecretCipher.Encrypted encrypted = secretCipher.encrypt(key);
        p.setEmrSecret(encrypted.ciphertext(), encrypted.iv(), encrypted.tag(), ApiSecretHasher.hash(key));
        pharmacyRepository.save(p);

        auditService.log(AuditEntry.of(AuditModule.SETTINGS, "EMR_KEY_GENERATED", "PHARMACY")
                .pharmacyId(p.getId()).userId(TenantContext.userId()).entityId(p.getId()));

        return new EmrConnectionKeyResponse(key, p.getUpdatedAt());
    }

    /**
     * Disconnects the clinic. Clears the key as well as the address, so the inbound
     * surface stops accepting prescriptions at the same moment outbound updates stop
     * being sent — a half-disconnected integration is the state nobody can reason about.
     */
    @Transactional
    public EmrConnectionStatus disconnect() {
        Pharmacy p = load();
        p.disconnectEmrClinic();
        pharmacyRepository.save(p);

        auditService.log(AuditEntry.of(AuditModule.SETTINGS, "EMR_CLINIC_DISCONNECTED", "PHARMACY")
                .pharmacyId(p.getId()).userId(TenantContext.userId()).entityId(p.getId()));

        return toStatus(p);
    }

    private Pharmacy load() {
        return pharmacyRepository.findById(TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Pharmacy not found"));
    }

    /**
     * The clinic's address has to be an absolute http(s) URL, because it is where a
     * signed record of what a patient collected gets POSTed. A typo here is a delivery
     * that fails forever, and the pharmacist would only find out from a stuck queue.
     */
    private String validateCallbackUrl(String value) {
        String url = value == null ? "" : value.trim();
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if (!uri.isAbsolute() || uri.getHost() == null || !(scheme.equals("https") || scheme.equals("http"))) {
                throw new BadRequestException("The clinic address must be a full http(s) URL");
            }
        } catch (URISyntaxException e) {
            throw new BadRequestException("The clinic address must be a full http(s) URL");
        }
        return url;
    }

    private EmrConnectionStatus toStatus(Pharmacy p) {
        String pharmacyId = p.getId();
        boolean keyIssued = p.getEmrSecretCiphertext() != null
                && p.getEmrSecretIv() != null
                && p.getEmrSecretTag() != null;

        return new EmrConnectionStatus(
                pharmacyId,
                p.getName(),
                pharmacyBaseUrl,
                p.getEmrClinicName(),
                p.getEmrCallbackUrl(),
                keyIssued,
                p.getEmrConnectedAt(),
                keyIssued ? p.getUpdatedAt() : null,
                prescriptionRepository.countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNull(pharmacyId),
                prescriptionRepository.findLastEmrPrescriptionAt(pharmacyId),
                prescriptionRepository.countByPharmacyIdAndDispenseNotifyStatus(
                        pharmacyId, Prescription.NOTIFY_PENDING),
                prescriptionRepository.countByPharmacyIdAndDispenseNotifyStatus(
                        pharmacyId, Prescription.NOTIFY_FAILED),
                p.isEmrPaired(),
                p.getEmrPairedAt());
    }
}
