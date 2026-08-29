package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Duration;
import java.time.Instant;

/**
 * Maps the Prisma `Prescription` model (table "prescriptions") — a structured
 * record required before dispensing Schedule H/H1/X medicines under the Drugs
 * & Cosmetics Act (see {@link com.checkup.pharmacy.modules.billing.BillingService}'s
 * controlled-substance check).
 */
@Entity
@Table(name = "prescriptions")
public class Prescription extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "prescriptionNumber")
    private String prescriptionNumber;

    @Column(name = "externalEmrTenantId")
    private String externalEmrTenantId;

    @Column(name = "externalEmrPrescriptionId")
    private String externalEmrPrescriptionId;

    @Column(name = "externalEmrPrescriptionNumber")
    private String externalEmrPrescriptionNumber;

    @Column(name = "receivedAt")
    private Instant receivedAt;

    /**
     * Null until a pharmacist opens this prescription for the first time. Only meaningful
     * for a clinic-sourced prescription — see {@link #markViewed()} — and drives the
     * new-prescription count behind the top-nav badge.
     */
    @Column(name = "viewedAt")
    private Instant viewedAt;

    // ── Dispense callback to the clinic ──────────────────────────────────────
    //
    // All NULL on a counter-written prescription, which is most of them: NULL here
    // means "this never applied", not "not yet sent".

    /** PENDING | SENT | FAILED. See EmrDispenseCallbackService. */
    @Column(name = "dispenseNotifyStatus")
    private String dispenseNotifyStatus;

    @Column(name = "dispenseNotifiedAt")
    private Instant dispenseNotifiedAt;

    /** Last failure, in words a pharmacist can act on. Truncated to fit the column. */
    @Column(name = "dispenseNotifyError")
    private String dispenseNotifyError;

    /** Delivery attempts so far. Drives the backoff and the give-up cap. */
    @Column(name = "dispenseNotifyAttempts")
    private int dispenseNotifyAttempts;

    /**
     * When the sweeper may next try. NULL means nothing is scheduled — which covers both
     * a delivered callback and one we have given up on, and is deliberately not the same
     * as "due now".
     */
    @Column(name = "dispenseNotifyNextAttemptAt")
    private Instant dispenseNotifyNextAttemptAt;

    // ── Cancellation callback to the clinic ──────────────────────────────────
    //
    // Mirrors the dispense-notify block above exactly — same meaning, same state machine,
    // the opposite direction of fact. NULL throughout means "never applied".

    @Column(name = "cancelNotifyStatus")
    private String cancelNotifyStatus;

    @Column(name = "cancelNotifiedAt")
    private Instant cancelNotifiedAt;

    @Column(name = "cancelNotifyError")
    private String cancelNotifyError;

    @Column(name = "cancelNotifyAttempts")
    private int cancelNotifyAttempts;

    @Column(name = "cancelNotifyNextAttemptAt")
    private Instant cancelNotifyNextAttemptAt;

    @Column(name = "doctorId")
    private String doctorId;

    @Column(name = "doctorName")
    private String doctorName;

    @Column(name = "doctorRegNo")
    private String doctorRegNo;

    @Column(name = "doctorPhone")
    private String doctorPhone;

    @Column(name = "patientName")
    private String patientName;

    @Column(name = "patientAge")
    private Integer patientAge;

    @Column(name = "patientPhone")
    private String patientPhone;

    @Column(name = "patientGender")
    private String patientGender;

    @Column(name = "prescribedDate")
    private Instant prescribedDate;

    @Column(name = "validUntil")
    private Instant validUntil;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PrescriptionStatus status = PrescriptionStatus.ACTIVE;

    @Column(name = "notes")
    private String notes;

    @Column(name = "uploadId")
    private String uploadId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "doctorId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.doctor.Doctor doctor;

    protected Prescription() {
        // Required by JPA.
    }

    public static Prescription create(String pharmacyId, String prescriptionNumber, String doctorId,
                                      String doctorName, String doctorRegNo, String doctorPhone,
                                      String patientName, Integer patientAge, String patientPhone,
                                      String patientGender, Instant prescribedDate, Instant validUntil,
                                      String notes, String uploadId) {
        Prescription rx = new Prescription();
        rx.assignId(Cuid.generate());
        rx.pharmacyId = pharmacyId;
        rx.prescriptionNumber = prescriptionNumber;
        rx.doctorId = doctorId;
        rx.doctorName = doctorName;
        rx.doctorRegNo = doctorRegNo;
        rx.doctorPhone = doctorPhone;
        rx.patientName = patientName;
        rx.patientAge = patientAge;
        rx.patientPhone = patientPhone;
        rx.patientGender = patientGender;
        rx.prescribedDate = prescribedDate;
        rx.validUntil = validUntil;
        rx.status = PrescriptionStatus.ACTIVE;
        rx.notes = notes;
        rx.uploadId = uploadId;
        return rx;
    }

    public static Prescription createFromEmr(String pharmacyId, String prescriptionNumber,
                                             String externalEmrTenantId, String externalEmrPrescriptionId,
                                             String externalEmrPrescriptionNumber, String doctorId, String doctorName,
                                             String doctorRegNo, String doctorPhone, String patientName,
                                             Integer patientAge, String patientPhone, String patientGender,
                                             Instant prescribedDate, Instant validUntil, String notes) {
        Prescription rx = create(pharmacyId, prescriptionNumber, doctorId, doctorName, doctorRegNo, doctorPhone,
                patientName, patientAge, patientPhone, patientGender, prescribedDate, validUntil, notes, null);
        rx.externalEmrTenantId = externalEmrTenantId;
        rx.externalEmrPrescriptionId = externalEmrPrescriptionId;
        rx.externalEmrPrescriptionNumber = externalEmrPrescriptionNumber;
        rx.receivedAt = Instant.now();
        return rx;
    }

    /**
     * Replaces the clinic-editable fields with what the clinic sent this time — a doctor's
     * edit, re-pushed under the same externalEmrPrescriptionId.
     *
     * <p>Deliberately the opposite of {@link #applyFields}'s null-means-unchanged PATCH
     * semantics. The EMR sends its whole current view of the prescription on every push,
     * never a partial diff, so a field the clinic now has as null is null because the
     * clinic cleared it — leaving the old value in place would silently un-clear something
     * a doctor just removed.
     *
     * <p>Caller ({@code EmrIntegrationService}) is responsible for confirming the
     * prescription is still ACTIVE first — nothing here re-checks that, because by the time
     * an amendment reaches an entity method the decision has already been made.
     */
    public void applyEmrAmendment(String doctorId, String doctorName, String doctorRegNo, String doctorPhone,
                                  String patientName, Integer patientAge, String patientPhone, String patientGender,
                                  Instant prescribedDate, Instant validUntil, String notes) {
        this.doctorId = doctorId;
        this.doctorName = doctorName;
        this.doctorRegNo = doctorRegNo;
        this.doctorPhone = doctorPhone;
        this.patientName = patientName;
        this.patientAge = patientAge;
        this.patientPhone = patientPhone;
        this.patientGender = patientGender;
        this.prescribedDate = prescribedDate;
        this.validUntil = validUntil;
        this.notes = notes;
    }

    public void applyFields(String doctorId, String doctorName, String doctorRegNo, String patientName,
                            Integer patientAge, String patientPhone, String patientGender,
                            Instant prescribedDate, Instant validUntil, String notes) {
        if (doctorId != null) this.doctorId = doctorId;
        if (doctorName != null) this.doctorName = doctorName;
        if (doctorRegNo != null) this.doctorRegNo = doctorRegNo;
        if (patientName != null) this.patientName = patientName;
        if (patientAge != null) this.patientAge = patientAge;
        if (patientPhone != null) this.patientPhone = patientPhone;
        if (patientGender != null) this.patientGender = patientGender;
        if (prescribedDate != null) this.prescribedDate = prescribedDate;
        if (validUntil != null) this.validUntil = validUntil;
        if (notes != null) this.notes = notes;
    }

    public void markDispensed() {
        this.status = PrescriptionStatus.DISPENSED;
    }

    /**
     * Some, but not all, of what was prescribed has been handed over.
     *
     * <p>PARTIAL existed in the enum and was already accepted as billable by
     * BillingService, but nothing ever set it: every prescription-linked sale called
     * {@link #markDispensed()} outright, closing the prescription on the first visit
     * and refusing the patient the rest of their medicine.
     */
    public void markPartiallyDispensed() {
        this.status = PrescriptionStatus.PARTIAL;
    }

    public void cancel() {
        this.status = PrescriptionStatus.CANCELLED;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getPrescriptionNumber() { return prescriptionNumber; }

    public String getExternalEmrTenantId() { return externalEmrTenantId; }

    public String getExternalEmrPrescriptionId() { return externalEmrPrescriptionId; }

    public String getExternalEmrPrescriptionNumber() { return externalEmrPrescriptionNumber; }

    public Instant getReceivedAt() { return receivedAt; }

    public String getDoctorId() { return doctorId; }

    public String getDoctorName() { return doctorName; }

    public String getDoctorRegNo() { return doctorRegNo; }

    public String getDoctorPhone() { return doctorPhone; }

    public String getPatientName() { return patientName; }

    public Integer getPatientAge() { return patientAge; }

    public String getPatientPhone() { return patientPhone; }

    public String getPatientGender() { return patientGender; }

    public Instant getPrescribedDate() { return prescribedDate; }

    public Instant getValidUntil() { return validUntil; }

    public PrescriptionStatus getStatus() { return status; }

    public String getNotes() { return notes; }

    public String getUploadId() { return uploadId; }

    public com.checkup.pharmacy.modules.doctor.Doctor getDoctor() { return doctor; }

    // ── Dispense-callback state machine ──────────────────────────────────────

    public static final String NOTIFY_PENDING = "PENDING";
    public static final String NOTIFY_SENT = "SENT";
    public static final String NOTIFY_FAILED = "FAILED";

    /**
     * Queues a callback. Called by billing once a sale against a clinic prescription has
     * posted its quantities — the sale itself never delivers anything.
     *
     * <p>Resets the attempt count: this is a NEW fact to report, not a retry of the old
     * one, so it deserves a full budget of attempts even if an earlier callback for the
     * same prescription exhausted its own.
     */
    public void markDispenseNotifyPending() {
        this.dispenseNotifyStatus = NOTIFY_PENDING;
        this.dispenseNotifyError = null;
        this.dispenseNotifyAttempts = 0;
        this.dispenseNotifyNextAttemptAt = Instant.now();
    }

    public void markDispenseNotifySent() {
        this.dispenseNotifyStatus = NOTIFY_SENT;
        this.dispenseNotifiedAt = Instant.now();
        this.dispenseNotifyError = null;
        this.dispenseNotifyNextAttemptAt = null;
    }

    /**
     * Records a failed attempt, unless a later attempt has already succeeded.
     *
     * <p>That guard is the whole reason this takes {@code attemptStartedAt}. Deliveries run
     * on a pool and a slow one can outlive a fast one: attempt A starts, stalls; attempt B
     * starts, succeeds, writes SENT; A finally times out and reports failure. Without the
     * check, A would overwrite a genuinely delivered callback with FAILED and the sweeper
     * would send it all over again. If the success landed at or after this attempt began,
     * this attempt's opinion is stale — drop it.
     */
    public void markDispenseNotifyFailed(String error, Instant nextAttemptAt, Instant attemptStartedAt) {
        if (NOTIFY_SENT.equals(dispenseNotifyStatus)
                && dispenseNotifiedAt != null
                && attemptStartedAt != null
                && !dispenseNotifiedAt.isBefore(attemptStartedAt)) {
            return;
        }
        this.dispenseNotifyStatus = NOTIFY_FAILED;
        this.dispenseNotifyError = error;
        this.dispenseNotifyAttempts++;
        this.dispenseNotifyNextAttemptAt = nextAttemptAt;
    }

    /**
     * Puts a given-up callback back in the queue, for a human who has fixed whatever was
     * wrong. Clears the attempt count for the same reason {@link #markDispenseNotifyPending()}
     * does: someone has asserted the situation changed, so the old backoff is stale evidence.
     *
     * <p>Schedules the next automatic attempt a minute out rather than immediately. The caller
     * is about to deliver this itself, and dating it "now" would invite the sweeper to send the
     * same prescription at the same moment — harmless to the clinic, whose payload is
     * cumulative, but it doubles the load on a server that has usually just come back up.
     */
    public void requeueDispenseNotify() {
        this.dispenseNotifyStatus = NOTIFY_PENDING;
        this.dispenseNotifyAttempts = 0;
        this.dispenseNotifyNextAttemptAt = Instant.now().plus(MANUAL_RETRY_LEASE);
    }

    private static final Duration MANUAL_RETRY_LEASE = Duration.ofSeconds(60);

    // ── Cancel-callback state machine ────────────────────────────────────────
    //
    // Exact mirror of the dispense-notify state machine above — same four methods, same
    // meaning, the opposite fact. See those for the reasoning behind each one; it is not
    // repeated here.

    public void markCancelNotifyPending() {
        this.cancelNotifyStatus = NOTIFY_PENDING;
        this.cancelNotifyError = null;
        this.cancelNotifyAttempts = 0;
        this.cancelNotifyNextAttemptAt = Instant.now();
    }

    public void markCancelNotifySent() {
        this.cancelNotifyStatus = NOTIFY_SENT;
        this.cancelNotifiedAt = Instant.now();
        this.cancelNotifyError = null;
        this.cancelNotifyNextAttemptAt = null;
    }

    public void markCancelNotifyFailed(String error, Instant nextAttemptAt, Instant attemptStartedAt) {
        if (NOTIFY_SENT.equals(cancelNotifyStatus)
                && cancelNotifiedAt != null
                && attemptStartedAt != null
                && !cancelNotifiedAt.isBefore(attemptStartedAt)) {
            return;
        }
        this.cancelNotifyStatus = NOTIFY_FAILED;
        this.cancelNotifyError = error;
        this.cancelNotifyAttempts++;
        this.cancelNotifyNextAttemptAt = nextAttemptAt;
    }

    public void requeueCancelNotify() {
        this.cancelNotifyStatus = NOTIFY_PENDING;
        this.cancelNotifyAttempts = 0;
        this.cancelNotifyNextAttemptAt = Instant.now().plus(MANUAL_RETRY_LEASE);
    }

    /** True for a prescription that came from a clinic and so has somewhere to report back to. */
    public boolean isFromEmr() {
        return externalEmrTenantId != null && externalEmrPrescriptionId != null;
    }

    /**
     * Records that a pharmacist has now looked at this prescription at least once.
     *
     * <p>Idempotent by design — {@code null} check rather than an unconditional stamp —
     * so the "first seen" moment stays the first call, not whichever call happens to
     * land last. Calling this on a counter-written prescription is harmless: nothing
     * ever counts one of those as unseen in the first place.
     */
    public void markViewed() {
        if (viewedAt == null) {
            viewedAt = Instant.now();
        }
    }

    public Instant getViewedAt() { return viewedAt; }

    public String getDispenseNotifyStatus() { return dispenseNotifyStatus; }

    public Instant getDispenseNotifiedAt() { return dispenseNotifiedAt; }

    public String getDispenseNotifyError() { return dispenseNotifyError; }

    public int getDispenseNotifyAttempts() { return dispenseNotifyAttempts; }

    public Instant getDispenseNotifyNextAttemptAt() { return dispenseNotifyNextAttemptAt; }

    public String getCancelNotifyStatus() { return cancelNotifyStatus; }

    public Instant getCancelNotifiedAt() { return cancelNotifiedAt; }

    public String getCancelNotifyError() { return cancelNotifyError; }

    public int getCancelNotifyAttempts() { return cancelNotifyAttempts; }

    public Instant getCancelNotifyNextAttemptAt() { return cancelNotifyNextAttemptAt; }
}
