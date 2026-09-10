package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.BaseUnits;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.common.util.DispensePlausibility;
import com.checkup.pharmacy.common.util.PackUnits;
import com.checkup.pharmacy.modules.medicine.Medicine;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.math.BigDecimal;

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
     * The clinical volume/weight the clinic prescribed for a MEASURED (ML/GM) line, kept
     * verbatim even after {@link #quantity} has been rounded up to a whole-pack target — see
     * {@link #resolveMeasuredEmrQuantity}. Drives the "Prescribed: 105 ml" line on triage and
     * the dosage line on the label. Null for a countable line and for any line the clinic sent
     * as a plain unit count.
     */
    @Column(name = "prescribedVolumeClinical")
    private BigDecimal prescribedVolumeClinical;

    /** The unit {@link #prescribedVolumeClinical} is in — {@code "ML"} | {@code "GM"}. Null with no clinical volume. */
    @Column(name = "clinicalUom")
    private String clinicalUom;

    /**
     * Whole sealed packs the measured course was rounded UP to once the medicine's pack size
     * was known ({@code ceil(prescribedVolumeClinical / effectiveUnitsPerPack)}). Null while
     * the pack size is still unknown (the line is held for a pharmacist to enter a pack count)
     * and for every countable line. Display/label/audit only — {@link #quantity} already holds
     * the resolved dispense target in base units.
     */
    @Column(name = "roundedPackCount")
    private Integer roundedPackCount;

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
        // Same reasoning for the measured-line resolution: the caller re-runs
        // resolveMeasuredEmrQuantity against the new figure and pack size.
        this.prescribedVolumeClinical = null;
        this.clinicalUom = null;
        this.roundedPackCount = null;
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
        // A measured (mL/g) line that was held for the pharmacist has no pack size on record,
        // so the number they just entered IS the sealed-pack count — record it as such for the
        // label ("Qty: 2 bottles") while keeping the clinic's clinical volume for the slip.
        if (clinicalUom != null) {
            this.roundedPackCount = quantity;
        }
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

    /**
     * Resolves a measured (mL/g) EMR line now that its medicine — and so its base unit and
     * pack size — is known. {@code effectivePackSize} carries this pharmacy's override pack
     * size if set, else the catalogue's, else null.
     *
     * <p>A clinic's dose engine computes dose × frequency × duration, and for a syrup or a
     * cream that product is inherently a <b>volume</b>: the {@code quantity} on the EMR wire is
     * millilitres or grams, never a bottle count. Left as-is, the dispensing engine reads that
     * bare number in base units — for an unclassified medicine ({@code unitsPerPack <= 1})
     * "105" then means 105 <i>sealed bottles</i> ({@code DispensingService.resolveChunk}). This
     * turns it into a dispensable whole-pack target and never lets the millilitre figure reach
     * billing as a pack count.
     *
     * <ul>
     *   <li><b>Pack size known.</b> {@link #prescribedVolumeClinical} keeps the clinic's
     *       figure, {@link #roundedPackCount} = {@code ceil(volume / packSize)}, and
     *       {@link #quantity} becomes {@code roundedPackCount * packSize} — the real dispense
     *       target in base units, so {@link #isFullyDispensed()} and the dispensed write-back
     *       both compare millilitres to millilitres. The line is ready to bill; triage shows
     *       "105 ml → 2 bottles (95 ml over)".</li>
     *   <li><b>Pack size unknown.</b> Same as an "as directed" line: {@link #quantity} drops to
     *       the zero placeholder ({@link #needsQuantityConfirmation()}), the clinic's figure is
     *       kept in {@link #quantityCalculationNote} and {@link #prescribedVolumeClinical}, and
     *       a pharmacist enters the number of sealed packs at the counter, where
     *       {@code ConfirmQuantityPanel} already asks for a bottle count.</li>
     * </ul>
     *
     * <p>A no-op for a countable medicine (tablets/capsules were never ambiguous), a line
     * already awaiting a quantity, an auto-calculated one, or a non-EMR line (a quantity typed
     * into the native prescription form is entered in whatever unit that form shows).
     */
    public void resolveMeasuredEmrQuantity(Medicine medicine, Integer effectivePackSize) {
        if (externalEmrItemId == null || medicine == null
                || needsQuantityConfirmation() || quantityAutoCalculated) {
            return;
        }
        String baseUnit = BaseUnits.resolve(medicine.getBaseUnit(), medicine.getForm());
        if (!PackUnits.isMeasured(baseUnit)) {
            return;
        }
        int clinicalVolume = this.quantity;
        this.prescribedVolumeClinical = BigDecimal.valueOf(clinicalVolume);
        this.clinicalUom = baseUnit;

        String volumeUnit = "GM".equals(baseUnit) ? "grams" : "millilitres";
        String shortUnit = "GM".equals(baseUnit) ? "g" : "ml";
        String packWord = PackUnits.packUnitLabel(medicine.getUnit(), baseUnit);
        String packWordPlural = PackUnits.plural(packWord, 2);

        if (effectivePackSize != null && effectivePackSize > 0) {
            int packs = (int) Math.ceil((double) clinicalVolume / effectivePackSize);
            // A division is only as trustworthy as its divisor. Before committing this line to a
            // pack target, check the answer against what a course of this form can physically be
            // — a wrong catalogue pack size produces arithmetic that is correct at every step and
            // absurd at the end (40 ml of a topical ÷ a bad 5 ml pack size = eight bottles).
            // Held, never rejected: a real 5 ml ampoule course must still be dispensable, so this
            // routes to the same pharmacist confirmation a line with NO pack size already gets.
            String implausible = DispensePlausibility.implausiblePackCount(
                    medicine.getName(), medicine.getForm(), baseUnit, medicine.getUnit(),
                    packs, clinicalVolume, effectivePackSize);
            if (implausible != null) {
                this.roundedPackCount = null;
                this.quantityCalculationNote = implausible;
                this.quantity = 0;
                return;
            }
            int target = packs * effectivePackSize;
            this.roundedPackCount = packs;
            this.quantity = target;
            int excess = target - clinicalVolume;
            this.quantityCalculationNote = "Clinic prescribed " + clinicalVolume + " " + shortUnit
                    + " — dispensing " + packs + " sealed " + PackUnits.plural(packWord, packs)
                    + " (" + target + " " + shortUnit
                    + (excess > 0 ? ", " + excess + " " + shortUnit + " over" : "")
                    + "). A sealed " + packWord + " can't be split.";
            return;
        }

        // No pack size on record: hold for a pharmacist, exactly like an "as directed" line.
        // Phrased to match PrescriptionQuantityCalculator's "measured in …" refusal so
        // ConfirmQuantityPanel reads the packaging word and the volume unit straight out of it.
        this.roundedPackCount = null;
        this.quantityCalculationNote = "The clinic prescribed " + clinicalVolume + " " + shortUnit
                + ", but this medicine is measured in " + volumeUnit + " with no pack size on record — "
                + "enter the number of " + packWordPlural + " to dispense (whole sealed " + packWordPlural
                + ", not the total " + volumeUnit + ").";
        this.quantity = 0;
    }

    /**
     * Re-runs {@link #resolveMeasuredEmrQuantity} for a line whose stored resolution no longer
     * matches the catalogue it was resolved against. Returns true when this line was rewritten.
     *
     * <h2>Why this has to exist</h2>
     * A line is resolved to a pack target ONCE, at ingest, and {@link #resolveMeasuredEmrQuantity}
     * is deliberately a no-op afterwards so a settled quantity is never second-guessed. But the
     * catalogue is mutable: a medicine sitting unclassified when a prescription arrives can be
     * given a base unit and a pack volume the next day. Nothing re-resolves the open lines, so
     * the stored number silently changes meaning — a line ingested as "40" while the medicine was
     * countable is read by the dispensing engine, against today's catalogue, as 40&nbsp;ml to be
     * divided into bottles. Every screen then agrees on a number nobody ever computed.
     *
     * <h2>Invariants</h2>
     * Narrow on purpose. Rewriting a prescription is only safe when nobody can have acted on it
     * yet, and re-resolving a line that is fine would be churn a pharmacist has to re-read:
     * <ul>
     *   <li><b>EMR lines only.</b> A counter-typed quantity is in whatever unit that form showed
     *       — only the EMR wire is documented to carry a clinical volume. Same guard
     *       {@link #resolveMeasuredEmrQuantity} already applies.</li>
     *   <li><b>Nothing dispensed.</b> {@code dispensedQty == 0}. A partly-filled line has a
     *       real-world handover behind it that a recomputed target would contradict.</li>
     *   <li><b>Something actually changed.</b> See {@link #isStaleAgainst} — an unchanged
     *       classification is left strictly alone.</li>
     * </ul>
     * The caller adds the one invariant an item cannot see: the prescription is still ACTIVE.
     *
     * @param effectivePackSize this pharmacy's live pack size (override first, catalogue second)
     */
    public boolean reResolveMeasuredEmrQuantity(Medicine medicine, Integer effectivePackSize) {
        if (externalEmrItemId == null || medicine == null || dispensedQty != 0) {
            return false;
        }
        String liveBaseUnit = BaseUnits.resolve(medicine.getBaseUnit(), medicine.getForm());
        if (!isStaleAgainst(liveBaseUnit, effectivePackSize)) {
            return false;
        }
        Integer clinicalVolume = clinicalVolumeForReResolution();
        if (clinicalVolume == null || clinicalVolume <= 0) {
            return false;
        }
        // Back to the pre-resolution state, then through the SAME conversion as a fresh ingest —
        // including its plausibility ceiling, so a re-resolution can hold a line just as an
        // ingest can. Reusing the method rather than repeating its arithmetic is the point: two
        // copies of this conversion is how the meanings drifted apart in the first place.
        this.quantity = clinicalVolume;
        this.prescribedVolumeClinical = null;
        this.clinicalUom = null;
        this.roundedPackCount = null;
        this.quantityCalculationNote = null;
        resolveMeasuredEmrQuantity(medicine, effectivePackSize);
        return true;
    }

    /**
     * True when this line's stored resolution disagrees with the live catalogue — either the
     * medicine crossed the measured/countable boundary, or the pack volume it was divided by
     * has changed.
     *
     * <p>The pack size a line was resolved against is not stored directly; it is recoverable as
     * {@code quantity / roundedPackCount}, since {@link #resolveMeasuredEmrQuantity} sets
     * {@code quantity = roundedPackCount × packSize}. A measured line with no
     * {@code roundedPackCount} was held for a pharmacist (no pack size on record, or an
     * implausible count), and a live pack size now on record is a real change from that.
     */
    boolean isStaleAgainst(String liveBaseUnit, Integer livePackSize) {
        boolean storedWasMeasured = clinicalUom != null;
        boolean liveIsMeasured = PackUnits.isMeasured(liveBaseUnit);
        if (storedWasMeasured != liveIsMeasured) {
            return true;
        }
        if (!liveIsMeasured) {
            return false;
        }
        Integer storedPackSize = roundedPackCount != null && roundedPackCount > 0
                ? quantity / roundedPackCount
                : null;
        return !java.util.Objects.equals(storedPackSize, livePackSize);
    }

    /**
     * The clinic's own volume figure to re-resolve from, or null when it cannot be recovered
     * honestly.
     *
     * <p>Two shapes. A line already resolved (or held) as measured kept the figure in
     * {@link #prescribedVolumeClinical} — always prefer it, because {@link #quantity} on such a
     * line is a rounded-up dispense target, not what the clinic asked for, and re-resolving from
     * the rounded number would inflate the course a little more on every catalogue edit. A line
     * that was never treated as measured has no such field, and its raw {@link #quantity} is
     * still exactly what the EMR sent — which for a measured medicine is millilitres or grams,
     * never a pack count (see {@link #resolveMeasuredEmrQuantity}).
     */
    private Integer clinicalVolumeForReResolution() {
        if (prescribedVolumeClinical != null) {
            return prescribedVolumeClinical.intValue();
        }
        return clinicalUom == null && roundedPackCount == null ? quantity : null;
    }

    public boolean isQuantityAutoCalculated() {
        return quantityAutoCalculated;
    }

    public String getQuantityCalculationNote() {
        return quantityCalculationNote;
    }

    public BigDecimal getPrescribedVolumeClinical() {
        return prescribedVolumeClinical;
    }

    public String getClinicalUom() {
        return clinicalUom;
    }

    public Integer getRoundedPackCount() {
        return roundedPackCount;
    }

    /** True when this line is a measured (mL/g) course rounded up to whole sealed packs. */
    public boolean isMeasuredRoundedUp() {
        return roundedPackCount != null && prescribedVolumeClinical != null
                && BigDecimal.valueOf((long) quantity).compareTo(prescribedVolumeClinical) > 0;
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
