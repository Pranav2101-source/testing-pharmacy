package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;

/**
 * A pharmacy-owned stand-in identity for a medicine GRN received that the global
 * {@link Medicine} catalog doesn't (yet) know — table "pharmacy_medicines". GRN
 * receiving must never block on catalog matching (see {@code GRNItem.localMedicineId}
 * / {@code Inventory.localMedicineId}, exactly one of medicineId/localMedicineId set,
 * enforced by a DB CHECK constraint).
 *
 * <p>Carries only what billing/GST-reporting need to snapshot onto an
 * {@code InvoiceItem}, mirroring the equivalent {@link Medicine} columns by name.
 * {@link #linkedMedicineId} is the eventual global-catalog link, set by the
 * background matcher (deterministic tiers only — see the shared medicine matcher)
 * or a pharmacist's manual confirm. Linking is additive: it never rewrites a GRN
 * item, a batch, or an invoice line that already exists — only future lookups
 * benefit. A fuzzy (trigram) candidate is never auto-linked, only ever surfaced
 * for a human to confirm ({@link MedicineMatchStatus#SUGGESTED}).
 */
@Entity
@Table(name = "pharmacy_medicines")
public class PharmacyMedicine extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "name")
    private String name;

    @Column(name = "manufacturer")
    private String manufacturer;

    @Column(name = "genericName")
    private String genericName;

    @Column(name = "strength")
    private String strength;

    @Column(name = "form")
    private String form;

    @Column(name = "unit")
    private String unit;

    @Column(name = "hsnCode")
    private String hsnCode;

    @Column(name = "gstRate")
    private BigDecimal gstRate;

    @Column(name = "schedule")
    private String schedule;

    @Column(name = "linkedMedicineId")
    private String linkedMedicineId;

    @Column(name = "matchStatus")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private MedicineMatchStatus matchStatus = MedicineMatchStatus.PENDING;

    protected PharmacyMedicine() {
        // Required by JPA.
    }

    public static PharmacyMedicine create(String pharmacyId, String name, String manufacturer, String genericName,
                                          String strength, String form, String unit, String hsnCode,
                                          BigDecimal gstRate, String schedule) {
        PharmacyMedicine m = new PharmacyMedicine();
        m.assignId(Cuid.generate());
        m.pharmacyId = pharmacyId;
        m.name = name;
        m.manufacturer = manufacturer;
        m.genericName = genericName;
        m.strength = strength;
        m.form = form;
        m.unit = unit;
        m.hsnCode = hsnCode;
        m.gstRate = gstRate;
        m.schedule = schedule;
        m.matchStatus = MedicineMatchStatus.PENDING;
        return m;
    }

    /** The background matcher found a deterministic (exact-id/exact-name/generic+strength+form) hit. */
    public void linkTo(String medicineId) {
        this.linkedMedicineId = medicineId;
        this.matchStatus = MedicineMatchStatus.LINKED;
    }

    /** A pharmacist confirmed a fuzzy "did you mean?" suggestion — same effect as an automatic link. */
    public void confirmLink(String medicineId) {
        linkTo(medicineId);
    }

    /** Only a fuzzy (similarity-score) candidate exists — never auto-linked, needs a human to confirm. */
    public void markSuggested() {
        if (this.matchStatus == MedicineMatchStatus.PENDING) {
            this.matchStatus = MedicineMatchStatus.SUGGESTED;
        }
    }

    /** The background matcher found nothing plausible — stays local for good, not an error. */
    public void keepLocal() {
        if (this.matchStatus == MedicineMatchStatus.PENDING) {
            this.matchStatus = MedicineMatchStatus.KEPT_LOCAL;
        }
    }

    /**
     * Reverses a link — a pharmacist confirmed the wrong global medicine and is undoing it.
     * Lands on {@code KEPT_LOCAL}, not {@code PENDING}: going back to PENDING would let the
     * background matcher (or the scheduled backstop) reconsider it and, if the wrong link was
     * a deterministic EXACT_NAME/GENERIC_STRENGTH_FORM hit, silently re-create the very link a
     * human just rejected. KEPT_LOCAL is a stable end state a human can still revisit manually.
     */
    public void unlink() {
        this.linkedMedicineId = null;
        this.matchStatus = MedicineMatchStatus.KEPT_LOCAL;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getName() { return name; }

    public String getManufacturer() { return manufacturer; }

    public String getGenericName() { return genericName; }

    public String getStrength() { return strength; }

    public String getForm() { return form; }

    public String getUnit() { return unit; }

    public String getHsnCode() { return hsnCode; }

    public BigDecimal getGstRate() { return gstRate; }

    public String getSchedule() { return schedule; }

    public String getLinkedMedicineId() { return linkedMedicineId; }

    public MedicineMatchStatus getMatchStatus() { return matchStatus; }
}
