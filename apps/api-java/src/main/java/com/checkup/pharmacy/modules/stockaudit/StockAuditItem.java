package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.inventory.Inventory;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/**
 * Maps the Prisma `StockAuditItem` model (table "stock_audit_items") — one row
 * per inventory batch snapshotted into a {@link StockAuditSession} at creation.
 * {@code expectedQty} is frozen at session creation; {@code countedQty} is
 * entered by staff during the count; {@code varianceQty} is always
 * countedQty - expectedQty, kept in sync by {@link #recordCount}.
 *
 * <p>{@code expectedLooseUnits}/{@code countedLooseUnits}/{@code varianceLooseUnits} are the
 * same three fields for a batch's loose (cut-strip) remainder — 0 for every pack-only
 * medicine, since {@code Inventory.looseUnits} itself is never anything else there.
 * {@code countedLooseUnits} stays {@code null} until staff explicitly count it, and a null
 * loose count is never treated as "counted zero": leaving the loose field untouched on the
 * count sheet must not silently wipe out a real loose remainder at approval — see
 * {@link #recordCount} and {@code StockAuditService#doApprove}.
 */
@Entity
@Table(name = "stock_audit_items")
public class StockAuditItem extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "sessionId")
    private String sessionId;

    @Column(name = "inventoryId")
    private String inventoryId;

    @Column(name = "expectedQty")
    private int expectedQty;

    @Column(name = "countedQty")
    private Integer countedQty;

    @Column(name = "varianceQty")
    private Integer varianceQty;

    @Column(name = "expectedLooseUnits")
    private int expectedLooseUnits;

    @Column(name = "countedLooseUnits")
    private Integer countedLooseUnits;

    @Column(name = "varianceLooseUnits")
    private Integer varianceLooseUnits;

    @Column(name = "notes")
    private String notes;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "inventoryId", insertable = false, updatable = false)
    private Inventory inventory;

    protected StockAuditItem() {
        // Required by JPA.
    }

    public static StockAuditItem create(String pharmacyId, String sessionId, String inventoryId, int expectedQty,
                                        int expectedLooseUnits) {
        StockAuditItem item = new StockAuditItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.sessionId = sessionId;
        item.inventoryId = inventoryId;
        item.expectedQty = expectedQty;
        item.expectedLooseUnits = expectedLooseUnits;
        return item;
    }

    public void recordCount(Integer countedQty, Integer countedLooseUnits, String notes) {
        if (countedQty != null) {
            this.countedQty = countedQty;
            this.varianceQty = countedQty - expectedQty;
        }
        if (countedLooseUnits != null) {
            this.countedLooseUnits = countedLooseUnits;
            this.varianceLooseUnits = countedLooseUnits - expectedLooseUnits;
        }
        if (notes != null) {
            this.notes = notes;
        }
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSessionId() { return sessionId; }

    public String getInventoryId() { return inventoryId; }

    public int getExpectedQty() { return expectedQty; }

    public Integer getCountedQty() { return countedQty; }

    public Integer getVarianceQty() { return varianceQty; }

    public int getExpectedLooseUnits() { return expectedLooseUnits; }

    public Integer getCountedLooseUnits() { return countedLooseUnits; }

    public Integer getVarianceLooseUnits() { return varianceLooseUnits; }

    public String getNotes() { return notes; }

    public Inventory getInventory() { return inventory; }
}
