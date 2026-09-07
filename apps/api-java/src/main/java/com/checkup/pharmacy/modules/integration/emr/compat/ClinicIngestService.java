package com.checkup.pharmacy.modules.integration.emr.compat;

import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.modules.integration.emr.EmrPrescriptionIntake;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.compat.dto.ClinicIngestResponse;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionIngestRequest;
import com.checkup.pharmacy.modules.integration.emr.dto.EmrPrescriptionSnapshot;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Translates the clinic's prescription shape into this product's, and hands it to the one
 * ingestion engine.
 *
 * <h2>This class may translate. It may not decide.</h2>
 * Every rule about what a prescription <em>is</em> — idempotency, duplicate item ids,
 * medicine matching, numbering — lives in
 * {@link com.checkup.pharmacy.modules.integration.emr.EmrIntegrationService} and is reached
 * through it. The moment logic forks here, the two surfaces begin disagreeing and every bug
 * has to be found twice, in two places, by someone who does not know the second one exists.
 *
 * <h2>What translation actually costs</h2>
 * The two shapes are not the same shape, and three differences need a decision rather than
 * a field copy:
 * <ul>
 *   <li><b>Fields with nowhere to go.</b> ABHA number, EMR patient/doctor/clinic-internal
 *       ids, specialty, route, timing. These are dropped from the structured columns rather
 *       than invented columns for, but the clinically meaningful ones are folded into the
 *       line's notes so a pharmacist still sees them. Losing "before food" off a label
 *       because this product has no column for it would be a real harm.</li>
 *   <li><b>Fields the native DTO validates more strictly than a machine feed should be.</b>
 *       See {@link ClinicIngestRequest} — sanitise and drop, do not reject.</li>
 *   <li><b>A missing quantity.</b> Ingested as zero and reported, not rejected.</li>
 * </ul>
 */
@Service
public class ClinicIngestService {

    /** Native DTO caps: notes 500, item notes 200. Truncating beats a validation failure. */
    private static final int MAX_NOTES = 500;
    private static final int MAX_ITEM_NOTES = 200;

    /** A bare 10-digit Indian mobile, which is all the native path will accept. */
    private static final Pattern USABLE_MOBILE = Pattern.compile("^[6-9]\\d{9}$");

    private final EmrPrescriptionIntake intake;
    private final PrescriptionRepository prescriptionRepository;

    public ClinicIngestService(EmrPrescriptionIntake intake,
                               PrescriptionRepository prescriptionRepository) {
        this.intake = intake;
        this.prescriptionRepository = prescriptionRepository;
    }

    public ClinicIngestResponse ingest(ClinicIngestRequest request) {
        // Read before the write, so the clinic can be told whether this was new. Best effort
        // by construction — a concurrent duplicate may report false — and harmless because
        // ingestion is idempotent regardless of what this says. See ClinicIngestResponse.
        boolean alreadyExisted = prescriptionRepository
                .findByPharmacyIdAndExternalEmrTenantIdAndExternalEmrPrescriptionId(
                        TenantContext.pharmacyId(), request.emrClinicId().trim(),
                        request.emrPrescriptionId().trim())
                .isPresent();

        EmrPrescriptionSnapshot snapshot = intake.ingest(toNative(request));

        int unmatched = (int) snapshot.items().stream()
                .filter(i -> i.medicineId() == null)
                .count();
        // Read from the STORED lines, not the request: a missing quantity the calculator
        // resolved from dosage + duration (see PrescriptionQuantityCalculator) is no longer
        // unconfirmed, and counting the request's raw zero here would tell the clinic a
        // pharmacist still has work that ingest already finished.
        int unconfirmedQuantity = (int) snapshot.items().stream()
                .filter(i -> i.prescribedQuantity() <= 0)
                .count();

        return new ClinicIngestResponse(snapshot.pharmacyPrescriptionId(), snapshot.pharmacyPrescriptionNumber(),
                snapshot.status(), alreadyExisted, unmatched, unconfirmedQuantity);
    }

    private EmrPrescriptionIngestRequest toNative(ClinicIngestRequest r) {
        ClinicIngestRequest.Patient patient = r.patient();
        ClinicIngestRequest.Doctor doctor = r.doctor();

        List<EmrPrescriptionIngestRequest.Item> items = new ArrayList<>();
        for (ClinicIngestRequest.Item item : r.items()) {
            items.add(new EmrPrescriptionIngestRequest.Item(
                    item.emrItemId().trim(),
                    item.medicineName().trim(),
                    // The clinic's medicineId is ITS catalogue's id and is never a valid id
                    // in this one. Passing it through would invite a lookup that either
                    // finds nothing or, far worse, finds an unrelated medicine that happens
                    // to share an id shape.
                    null,
                    trimToNull(item.strength()),
                    // No schedule (H/H1/X) arrives on this contract. Left null rather than
                    // guessed: a wrong schedule would mislead the controlled-substance check
                    // that governs whether a sale is legal.
                    null,
                    item.quantity() == null || item.quantity() < 0 ? 0 : item.quantity(),
                    dosageForCalculation(item),
                    trimToNull(item.duration()),
                    itemNotes(item)));
        }

        return new EmrPrescriptionIngestRequest(
                r.emrClinicId().trim(),
                r.emrPrescriptionId().trim(),
                trimToNull(r.prescriptionNumber()),
                doctor == null ? null : ValidationPatterns.normalizeName(doctor.name()),
                doctor == null ? null : trimToNull(doctor.registrationNo()),
                doctor == null ? null : usableMobile(doctor.phone()),
                patient == null ? null : ValidationPatterns.normalizeName(patient.name()),
                patient == null ? null : usableAge(patient.age()),
                patient == null ? null : usableMobile(patient.phone()),
                patient == null ? null : trimToNull(patient.gender()),
                r.prescribedDate(),
                // No validity date on this contract. Null means "no stated expiry", which
                // the rest of the product already handles.
                null,
                truncate(r.notes(), MAX_NOTES),
                items);
    }

    /**
     * The text {@link com.checkup.pharmacy.modules.prescription.PrescriptionQuantityCalculator}
     * gets to find a dosing pattern in.
     *
     * <p>This contract carries {@code dosage} and {@code frequency} as two separate fields (a
     * dose amount and a schedule like {@code "1-0-1"}), where the native path only has one
     * {@code dosage} field for both — see that DTO's own note on why. A clinic that puts its
     * {@code 1-0-1}-style pattern in {@code frequency} rather than {@code dosage} would otherwise
     * be invisible to the calculator, which only ever reads the native {@code dosage} field:
     * {@link #itemNotes} already folds {@code frequency} in for a pharmacist to READ, but reading
     * and calculating are different needs, and folding it in only as free text among route/timing/
     * instructions buries it exactly where a pattern-matcher does not look. Concatenating both
     * here costs nothing when a clinic already puts the pattern in {@code dosage} — the calculator
     * ignores surrounding text — and recovers it for the clinics that do not.
     */
    private static String dosageForCalculation(ClinicIngestRequest.Item item) {
        String dosage = trimToNull(item.dosage());
        String frequency = trimToNull(item.frequency());
        if (dosage == null) {
            return frequency;
        }
        if (frequency == null || frequency.equalsIgnoreCase(dosage)) {
            return dosage;
        }
        // max 100 on the native DTO's own dosage field — truncating beats failing the whole
        // prescription over a combined string that ran long, same policy as truncate() elsewhere
        // on this path.
        return truncate(dosage + " " + frequency, 100);
    }

    /**
     * Folds the dosing detail this product has no column for into the line's notes, so it
     * reaches the label and the pharmacist rather than being dropped on the floor.
     *
     * <p>Ordered the way it would be spoken: how, when, then anything else.
     */
    private static String itemNotes(ClinicIngestRequest.Item item) {
        List<String> parts = new ArrayList<>();
        addIfPresent(parts, item.frequency());
        addIfPresent(parts, item.route());
        addIfPresent(parts, item.timing());
        addIfPresent(parts, item.instructions());
        if (parts.isEmpty()) {
            return null;
        }
        return truncate(String.join(" · ", parts), MAX_ITEM_NOTES);
    }

    private static void addIfPresent(List<String> parts, String value) {
        String trimmed = trimToNull(value);
        if (trimmed != null) {
            parts.add(trimmed);
        }
    }

    /**
     * Returns the phone only if it survives normalisation into something the native path
     * accepts, and null otherwise.
     *
     * <p>Dropping beats rejecting: a phone number is a convenience for calling a patient
     * back, and refusing an entire prescription over one is a worse outcome than not having
     * it. Whatever arrived is still visible to the clinic in its own record.
     */
    private static String usableMobile(String raw) {
        String normalized = ValidationPatterns.normalizeMobile(trimToNull(raw));
        if (normalized == null || !USABLE_MOBILE.matcher(normalized).matches()) {
            return null;
        }
        return normalized;
    }

    /** Ages outside the native 0–150 range are dropped rather than clamped: a clamped age is a fact nobody stated. */
    private static Integer usableAge(Integer age) {
        if (age == null || age < 0 || age > 150) {
            return null;
        }
        return age;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String truncate(String value, int max) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            return null;
        }
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}
