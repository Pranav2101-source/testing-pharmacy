package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.Cuid;
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

    public String getPharmacyId() { return pharmacyId; }

    public String getPrescriptionId() { return prescriptionId; }

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

    /** True once at least the prescribed quantity has been handed over. */
    public boolean isFullyDispensed() {
        return this.dispensedQty >= this.quantity;
    }

    public String getDosage() { return dosage; }

    public String getDuration() { return duration; }

    public String getNotes() { return notes; }
}
