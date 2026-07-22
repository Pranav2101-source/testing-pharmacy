package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.domain.IdOnlyEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Maps the Prisma `BatchRecall` model (table "batch_recalls") — the authoritative,
 * regulatory record for every recall action. Affected batches are quarantined
 * (status = QUARANTINE) and one {@link InventoryMovement} is written per item with
 * referenceType = "BATCH_RECALL" and referenceId = this row's id.
 */
@Entity
@Table(name = "batch_recalls")
public class BatchRecall extends IdOnlyEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "batchNumber")
    private String batchNumber;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "reason")
    private String reason;

    @Column(name = "recalledBy")
    private String recalledBy;

    @Column(name = "recalledAt")
    private Instant recalledAt;

    @Column(name = "affectedIds")
    @JdbcTypeCode(SqlTypes.ARRAY)
    private String[] affectedIds;

    protected BatchRecall() {
        // Required by JPA.
    }

    public static BatchRecall create(String pharmacyId, String batchNumber, String medicineId,
                                     String reason, String recalledBy, String[] affectedIds) {
        BatchRecall r = new BatchRecall();
        r.assignId(Cuid.generate());
        r.pharmacyId = pharmacyId;
        r.batchNumber = batchNumber;
        r.medicineId = medicineId;
        r.reason = reason;
        r.recalledBy = recalledBy;
        r.recalledAt = Instant.now();
        r.affectedIds = affectedIds;
        return r;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getBatchNumber() { return batchNumber; }

    public String getMedicineId() { return medicineId; }

    public String getReason() { return reason; }

    public String getRecalledBy() { return recalledBy; }

    public Instant getRecalledAt() { return recalledAt; }

    public String[] getAffectedIds() { return affectedIds; }
}
