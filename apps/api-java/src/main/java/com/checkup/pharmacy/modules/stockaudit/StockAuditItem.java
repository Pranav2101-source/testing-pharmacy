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

    @Column(name = "notes")
    private String notes;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "inventoryId", insertable = false, updatable = false)
    private Inventory inventory;

    protected StockAuditItem() {
        // Required by JPA.
    }

    public static StockAuditItem create(String pharmacyId, String sessionId, String inventoryId, int expectedQty) {
        StockAuditItem item = new StockAuditItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.sessionId = sessionId;
        item.inventoryId = inventoryId;
        item.expectedQty = expectedQty;
        return item;
    }

    public void recordCount(Integer countedQty, String notes) {
        if (countedQty != null) {
            this.countedQty = countedQty;
            this.varianceQty = countedQty - expectedQty;
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

    public String getNotes() { return notes; }

    public Inventory getInventory() { return inventory; }
}
