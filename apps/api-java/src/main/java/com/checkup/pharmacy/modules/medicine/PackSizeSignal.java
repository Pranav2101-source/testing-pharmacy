package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;

/**
 * One pharmacist disagreeing with the dispensing engine about how many packs a course needs.
 *
 * <p>Recorded at the till, which is the only place in the system where an inference about a
 * pack meets the pack itself. Phases 1 and 2 reason about the divisor without ever seeing the
 * product; this is the shelf answering back.
 *
 * <p><b>A signal asserts nothing.</b> Overriding the engine is ordinary — the patient wanted
 * less, the shelf was short, the course was split — so one row here is far more likely to be
 * routine than a catalogue error. It is a vote. {@code PackSizeReviewService} acts only on a
 * quorum of them from more than one pharmacy (see {@link
 * com.checkup.pharmacy.common.util.PackSizeQuorum}), and even then only quarantines.
 *
 * @see com.checkup.pharmacy.modules.medicine.PackSizeReviewService
 */
@Entity
@Table(name = "pack_size_signals")
public class PackSizeSignal extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "invoiceId")
    private String invoiceId;

    @Column(name = "prescriptionItemId")
    private String prescriptionItemId;

    /** Sealed packs the dispensing engine resolved the course to. */
    @Column(name = "enginePackCount")
    private int enginePackCount;

    /** Sealed packs that actually went over the counter. */
    @Column(name = "actualPackCount")
    private int actualPackCount;

    /** The clinical figure the conversion started from — "40 ml". */
    @Column(name = "clinicalVolume")
    private BigDecimal clinicalVolume;

    /** The divisor the engine used, i.e. the pack size being disagreed with. */
    @Column(name = "declaredPackSize")
    private int declaredPackSize;

    /**
     * What one pack must hold for the pharmacist's count to have been right.
     *
     * <p>A LOWER BOUND on the truth, never a measurement: 40&nbsp;ml handed over as one bottle
     * implies "at least 40" when the bottle is really 60. Strong enough to prove a declared
     * 5&nbsp;ml wrong, and far too weak to replace it — which is exactly why the review job
     * quarantines rather than corrects.
     */
    @Column(name = "impliedPackSize")
    private int impliedPackSize;

    /** Stamped once a quorum sweep has counted this signal, so it is never counted twice. */
    @Column(name = "resolvedAt")
    private Instant resolvedAt;

    @Column(name = "resolutionNote")
    private String resolutionNote;

    protected PackSizeSignal() {
        // Required by JPA.
    }

    /**
     * Builds a signal from what the counter actually did, or returns null when the numbers
     * cannot say anything useful.
     *
     * <p>Returning null rather than throwing is deliberate: the caller is in the middle of
     * saving a bill, and a telemetry row that cannot be derived must never be the reason a sale
     * fails. Every rejection below is a case where the arithmetic would be meaningless, not an
     * error anybody needs to hear about.
     */
    public static PackSizeSignal capture(String pharmacyId, String medicineId, String invoiceId,
                                         String prescriptionItemId, int enginePackCount, int actualPackCount,
                                         BigDecimal clinicalVolume, int declaredPackSize) {
        if (pharmacyId == null || medicineId == null) {
            return null;
        }
        // Nothing was overridden — the engine and the counter agree, which is the common case
        // and carries no information about the pack.
        if (enginePackCount == actualPackCount) {
            return null;
        }
        // A line nothing was handed over against (out of stock, held, removed) says nothing
        // about the pack size; it says something about the shelf.
        if (actualPackCount <= 0 || enginePackCount <= 0) {
            return null;
        }
        if (clinicalVolume == null || clinicalVolume.signum() <= 0 || declaredPackSize <= 0) {
            return null;
        }

        // Rounded UP: the pharmacist's packs had to COVER the prescribed volume, so each pack
        // holds at least this much. Rounding down would imply a pack smaller than what was
        // demonstrably dispensed.
        int implied = clinicalVolume
                .divide(BigDecimal.valueOf(actualPackCount), 0, RoundingMode.CEILING)
                .intValue();
        if (implied <= 0) {
            return null;
        }

        PackSizeSignal s = new PackSizeSignal();
        s.assignId(Cuid.generate());
        s.pharmacyId = pharmacyId;
        s.medicineId = medicineId;
        s.invoiceId = invoiceId;
        s.prescriptionItemId = prescriptionItemId;
        s.enginePackCount = enginePackCount;
        s.actualPackCount = actualPackCount;
        s.clinicalVolume = clinicalVolume;
        s.declaredPackSize = declaredPackSize;
        s.impliedPackSize = implied;
        return s;
    }

    /** Marks this signal as counted by a quorum sweep, so a later sweep does not count it again. */
    public void resolve(String note, Instant when) {
        this.resolvedAt = when;
        this.resolutionNote = note;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getMedicineId() { return medicineId; }

    public String getInvoiceId() { return invoiceId; }

    public String getPrescriptionItemId() { return prescriptionItemId; }

    public int getEnginePackCount() { return enginePackCount; }

    public int getActualPackCount() { return actualPackCount; }

    public BigDecimal getClinicalVolume() { return clinicalVolume; }

    public int getDeclaredPackSize() { return declaredPackSize; }

    public int getImpliedPackSize() { return impliedPackSize; }

    public Instant getResolvedAt() { return resolvedAt; }

    public String getResolutionNote() { return resolutionNote; }
}
