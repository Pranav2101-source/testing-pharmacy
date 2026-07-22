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
}
