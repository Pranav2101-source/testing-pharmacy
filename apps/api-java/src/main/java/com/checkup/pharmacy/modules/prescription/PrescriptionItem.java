package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.BaseUnits;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.medicine.Medicine;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** Maps the Prisma `PrescriptionItem` model (table "prescription_items") — one prescribed drug line. */
@Entity
@Table(name = "prescription_items")
public class PrescriptionItem extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "prescriptionId")
    private String prescriptionId;

    @Column(name = "externalEmrItemId")
    private String externalEmrItemId;

    @Column(name = "medicineName")
    private String medicineName;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "schedule")
    private String schedule;

    @Column(name = "quantity")
    private int quantity;

    @Column(name = "dispensedQty")
    private int dispensedQty;

    /**
     * True when {@link #quantity} was worked out from the dosing pattern and duration rather
     * than sent by the clinic — see {@link PrescriptionQuantityCalculator}.
     *
     * <p>Persisted rather than derived because it cannot be recovered later: once computed, the
     * number on this row is indistinguishable from one the clinic stated. A pharmacist reviewing
     * this prescription tomorrow is entitled to know which of the two they are looking at, and
     * that is the whole reason this column exists — it changes nothing about how the quantity is
     * used, only how it is labelled.
     */
    @Column(name = "quantityAutoCalculated")
    private boolean quantityAutoCalculated;

    /**
     * Why {@link #quantity} is what it is, in a sentence a pharmacist can read — either how it
     * was calculated ({@code "Calculated: 1-0-1 x 6 days = 12"}) or, while {@link
     * #needsQuantityConfirmation()} is still true, exactly why {@link PrescriptionQuantityCalculator}
     * declined to calculate one ({@code "This medicine is measured in millilitres..."}).
     *
     * <p>Persisted rather than left for the frontend to reconstruct: the reason a calculation was
     * refused depends on the calculator's own parsing rules, and duplicating those rules in the
     * UI just to explain a refusal would be exactly the kind of second copy of business logic
     * this feature is supposed to avoid. Cleared whenever a human settles the quantity — the
     * explanation stops being relevant the moment it stops being the reason nothing happened.
     */
    @Column(name = "quantityCalculationNote")
    private String quantityCalculationNote;

    /**
     * What the patient actually received, when it differs from what was prescribed.
     *
     * <p>NULL is the normal case and means "as prescribed". Deliberately separate from
     * {@code medicineId} rather than overwriting it: the line records what a doctor
     * ordered and must stay legible as that forever. Overwriting would mean "which
     * prescriptions ordered drug X" stops finding the ones where X was swapped out —
     * exactly the query a recall runs.
     */
    @Column(name = "dispensedMedicineId")
    private String dispensedMedicineId;

    /**
     * Denormalised beside the id because the callback runs on a background thread with a
     * hard timeout budget; a join there would add a query per line to the one path that
     * must stay cheap and must not fail.
     */
    @Column(name = "dispensedMedicineName")
    private String dispensedMedicineName;

    @Column(name = "dosage")
    private String dosage;

    @Column(name = "duration")
    private String duration;

    @Column(name = "notes")
    private String notes;

    protected PrescriptionItem() {
        // Required by JPA.
    }

    public static PrescriptionItem create(String pharmacyId, String prescriptionId, String medicineName,
                                          String medicineId, String schedule, int quantity, String dosage,
                                          String duration, String notes) {
        PrescriptionItem item = new PrescriptionItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.prescriptionId = prescriptionId;
        item.medicineName = medicineName;
        item.medicineId = medicineId;
        item.schedule = schedule;
        item.quantity = quantity;
        item.dispensedQty = 0;
        item.dosage = dosage;
        item.duration = duration;
        item.notes = notes;
        return item;
    }

    public static PrescriptionItem createFromEmr(String pharmacyId, String prescriptionId,
                                                  String externalEmrItemId, String medicineName,
                                                  String medicineId, String schedule, int quantity,
                                                  String dosage, String duration, String notes) {
        PrescriptionItem item = create(pharmacyId, prescriptionId, medicineName, medicineId, schedule,
                quantity, dosage, duration, notes);
        item.externalEmrItemId = externalEmrItemId;
        return item;
    }

    /**
     * Overwrites this line with what the clinic sent this time, for a line that survives an
     * amendment under the same externalEmrItemId.
     *
     * <p>{@code medicineId} is a caller decision, not something this method derives: pass
     * the OLD value to preserve a pharmacist's manual link when the medicine name is
     * unchanged, or a freshly re-matched value when it is not — see
     * {@code EmrIntegrationService}'s amendment path for which case applies. Getting that
     * choice right is the entire reason this exists rather than a delete-and-recreate: a
     * pharmacist's manual correction on an unrelated field change should not be discarded.
     *
     * <p>Never called on a line with {@code dispensedQty > 0} — the caller guarantees the
     * whole prescription is still ACTIVE before reaching here, which is the same condition
     * that guarantees every one of its lines has dispensed nothing yet.
     */
    public void applyEmrAmendment(String medicineName, String medicineId, String schedule, int quantity,
                                  String dosage, String duration, String notes) {
        this.medicineName = medicineName;
        this.medicineId = medicineId;
        this.schedule = schedule;
        this.quantity = quantity;
        this.dosage = dosage;
        this.duration = duration;
        this.notes = notes;
        // Whatever this line's quantity was derived from before, it is now whatever the clinic
        // just sent. The caller re-derives it afterwards if this push again carried none, which
        // sets a fresh note of its own — any note referring to the OLD dosage/duration would be
        // actively misleading here, not just stale.
        this.quantityAutoCalculated = false;
        this.quantityCalculationNote = null;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getPrescriptionId() { return prescriptionId; }

    public String getExternalEmrItemId() { return externalEmrItemId; }

    public String getMedicineName() { return medicineName; }

    public String getMedicineId() { return medicineId; }

    public String getSchedule() { return schedule; }

    public int getQuantity() { return quantity; }

    public int getDispensedQty() { return dispensedQty; }

    /**
     * Records units handed to the patient against this prescribed line.
     *
     * <p>Deliberately NOT capped at {@code quantity}. A pharmacist who dispenses more
     * than was written should leave a truthful record of it — clamping would make an
     * over-dispense indistinguishable from an exact one, which for a Schedule H
     * medicine is precisely the thing an audit needs to be able to see.
     */
    public void recordDispensed(int units) {
        this.dispensedQty += units;
    }

    /**
     * True once at least the prescribed quantity has been handed over.
     *
     * <p>{@code quantity > 0} is not redundant. A line the clinic sent with no usable
     * quantity is ingested as {@code quantity == 0} (see {@code ClinicIngestRequest.Item}) so
     * a pharmacist can settle the real amount at the counter — it is a placeholder, not a
     * prescribed amount of zero. Without this guard, {@code 0 >= 0} reads as "already fully
     * dispensed" from the moment the line is created, which let a prescription with an
     * unconfirmed line close as DISPENSED the instant every OTHER line was sold — the exact
     * failure the {@code medicineId == null} case is already protected against, just reached
     * by a different door. See {@code needsQuantityConfirmation}, which flags this same case
     * to a pharmacist the same way an unmatched medicine already is.
     */
    public boolean isFullyDispensed() {
        return this.quantity > 0 && this.dispensedQty >= this.quantity;
    }

    /**
     * True for a line the clinic sent with no usable quantity ("as directed"), ingested as a
     * zero placeholder rather than rejected — see {@link #isFullyDispensed()}. A pharmacist
     * has to confirm the real amount via {@link #confirmQuantity} before this line can ever
     * count toward billing or toward the prescription being complete.
     */
    public boolean needsQuantityConfirmation() {
        return this.quantity <= 0;
    }

    /**
     * Settles a quantity the clinic never sent, once a pharmacist has asked the patient (or
     * checked the paper prescription) — the counter-side resolution {@code ClinicIngestService}
     * promised when it accepted the line instead of rejecting the whole prescription.
     *
     * <p>Only callable while {@link #needsQuantityConfirmation()} — see the guard in
     * {@code PrescriptionService.confirmItemQuantity}, which is where "already confirmed" is
     * reported to the caller as a clear error rather than a silent overwrite.
     */
    public void confirmQuantity(int quantity) {
        this.quantity = quantity;
        // A person has now settled this number, so it is no longer a computed one — even if it
        // happens to equal what a calculation would have produced — and whatever note explained
        // an earlier refusal to calculate no longer describes this line's state.
        this.quantityAutoCalculated = false;
        this.quantityCalculationNote = null;
    }

    /**
     * Sets a quantity worked out from this line's own dosing pattern and duration, for a line
     * the clinic sent without one — see {@link PrescriptionQuantityCalculator}.
     *
     * <p>Only ever called while {@link #needsQuantityConfirmation()}: a clinic-stated quantity
     * is the prescribed amount and is never recomputed over. The flag it sets is what lets the
     * triage screen show the number as calculated rather than prescribed; {@code note} is the
     * one-line "how" (e.g. {@code "Calculated: 1-0-1 x 6 days = 12"}) shown alongside it.
     */
    public void applyCalculatedQuantity(int quantity, String note) {
        this.quantity = quantity;
        this.quantityAutoCalculated = true;
        this.quantityCalculationNote = note;
    }

    /**
     * Records why {@link PrescriptionQuantityCalculator} could NOT work out this line's quantity,
     * for a line still waiting on {@link #confirmQuantity} — so the pharmacist resolving it sees
     * the specific reason ("measured in millilitres", "no duration was sent", "SOS — not a daily
     * schedule") instead of a bare "quantity not stated".
     *
     * <p>Quantity is untouched: this line is exactly as unconfirmed as it was before the attempt.
     */
    public void recordQuantityCalculationNote(String note) {
        this.quantityCalculationNote = note;
    }

    /**
     * Attempts to derive this line's quantity from its own dosage and duration against {@code
     * medicine}'s base unit, applying whichever outcome {@link PrescriptionQuantityCalculator}
     * reaches — a computed quantity, or a note explaining why one could not be.
     *
     * <p>A no-op once this line already has a real quantity: {@link #needsQuantityConfirmation()}
     * guards it the same way {@link #confirmQuantity} and {@link #applyCalculatedQuantity} are
     * documented to — a clinic-stated or pharmacist-confirmed amount is never second-guessed by
     * recalculating over it. Also a no-op with no medicine, so every caller can pass whatever it
     * has on hand without checking first.
     *
     * <p>Written to be called from anywhere a medicine BECOMES known for a line still waiting on
     * a quantity — EMR ingest, an amendment, or a pharmacist manually linking a previously
     * unmatched line via {@code PrescriptionService.linkItemToMedicine} — so all three reach the
     * same automatic outcome instead of only the first ever getting it. Linking and calculating
     * are two different facts about a line and can each still fail independently: a link with an
     * uncalculable quantity leaves this line exactly as unconfirmed as an already-linked one that
     * could not be calculated, and a calculation is attempted even though nothing here required
     * one — it costs nothing when it does not apply.
     */
    public void calculateQuantityIfMissing(Medicine medicine) {
        if (medicine == null || !needsQuantityConfirmation()) {
            return;
        }
        PrescriptionQuantityCalculator.Result result = PrescriptionQuantityCalculator.calculate(
                dosage, duration, BaseUnits.resolve(medicine.getBaseUnit(), medicine.getForm()));
        if (result.isCalculated()) {
            applyCalculatedQuantity(result.quantity(),
                    "Calculated: " + dosage + " x " + duration + " = " + result.quantity());
        } else {
            recordQuantityCalculationNote(result.message());
        }
    }

    public boolean isQuantityAutoCalculated() {
        return quantityAutoCalculated;
    }

    public String getQuantityCalculationNote() {
        return quantityCalculationNote;
    }

    public String getDosage() { return dosage; }

    public String getDuration() { return duration; }

    public String getNotes() { return notes; }

    /**
     * Records that a different product was handed over against this line.
     *
     * <p>Called only when the sold medicine differs from the prescribed one. Both id and
     * name are stored: the id for querying, the name so the callback can report it without
     * a lookup.
     */
    public void recordSubstitution(String medicineId, String medicineName) {
        this.dispensedMedicineId = medicineId;
        this.dispensedMedicineName = medicineName;
    }

    /** True when something other than the prescribed product was dispensed. */
    public boolean isSubstituted() {
        return dispensedMedicineId != null && !dispensedMedicineId.equals(medicineId);
    }

    public String getDispensedMedicineId() { return dispensedMedicineId; }

    public String getDispensedMedicineName() { return dispensedMedicineName; }

    /**
     * Points an unmatched line at a catalogue product, chosen by a pharmacist.
     *
     * <p>Sets only the id. The medicineName stays exactly as the doctor wrote it — that text
     * is the record of what was ordered, and replacing it with the catalogue's wording would
     * quietly rewrite the prescription.
     */
    public void linkMedicine(String medicineId) {
        this.medicineId = medicineId;
    }
}
