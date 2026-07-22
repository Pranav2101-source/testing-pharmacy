package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Maps the Prisma `GRNItem` model (table "grn_items") — the line items of a
 * {@link GoodsReceiptNote}, relational (unlike PurchaseOrder.items) because
 * {@code inventoryId} is back-filled on confirm and the auto-suggestions /
 * pricing-history features join into this table directly.
 */
@Entity
@Table(name = "grn_items")
public class GRNItem extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "grnId")
    private String grnId;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "medicineName")
    private String medicineName;

    @Column(name = "batchNumber")
    private String batchNumber;

    @Column(name = "expiryDate")
    private Instant expiryDate;

    @Column(name = "orderedQty")
    private Integer orderedQty;

    @Column(name = "receivedQty")
    private int receivedQty;

    @Column(name = "freeQty")
    private int freeQty;

    @Column(name = "purchaseUnit")
    private String purchaseUnit = "UNIT";

    @Column(name = "conversionFactor")
    private int conversionFactor = 1;

    @Column(name = "purchaseRate")
    private BigDecimal purchaseRate;

    @Column(name = "mrp")
    private BigDecimal mrp;

    @Column(name = "discount")
    private BigDecimal discount = BigDecimal.ZERO;

    @Column(name = "gstRate")
    private BigDecimal gstRate;

    @Column(name = "cgst")
    private BigDecimal cgst;

    @Column(name = "sgst")
    private BigDecimal sgst;

    @Column(name = "amount")
    private BigDecimal amount;

    @Column(name = "inventoryId")
    private String inventoryId;

    protected GRNItem() {
        // Required by JPA.
    }

    public static GRNItem create(String pharmacyId, String grnId, String medicineId, String medicineName,
                                 String batchNumber, Instant expiryDate, Integer orderedQty, int receivedQty,
                                 int freeQty, String purchaseUnit, int conversionFactor, BigDecimal purchaseRate,
                                 BigDecimal mrp, BigDecimal discount, BigDecimal gstRate, BigDecimal cgst,
                                 BigDecimal sgst, BigDecimal amount) {
        GRNItem item = new GRNItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.grnId = grnId;
        item.medicineId = medicineId;
        item.medicineName = medicineName;
        item.batchNumber = batchNumber;
        item.expiryDate = expiryDate;
        item.orderedQty = orderedQty;
        item.receivedQty = receivedQty;
        item.freeQty = freeQty;
        item.purchaseUnit = purchaseUnit;
        item.conversionFactor = conversionFactor;
        item.purchaseRate = purchaseRate;
        item.mrp = mrp;
        item.discount = discount;
        item.gstRate = gstRate;
        item.cgst = cgst;
        item.sgst = sgst;
        item.amount = amount;
        return item;
    }

    public void setInventoryId(String inventoryId) {
        this.inventoryId = inventoryId;
    }

    /** Total base units received (receivedQty + freeQty), scaled by the purchase-unit conversion factor. */
    public int totalBaseUnits() {
        return (receivedQty + freeQty) * conversionFactor;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getGrnId() { return grnId; }

    public String getMedicineId() { return medicineId; }

    public String getMedicineName() { return medicineName; }

    public String getBatchNumber() { return batchNumber; }

    public Instant getExpiryDate() { return expiryDate; }

    public Integer getOrderedQty() { return orderedQty; }

    public int getReceivedQty() { return receivedQty; }

    public int getFreeQty() { return freeQty; }

    public String getPurchaseUnit() { return purchaseUnit; }

    public int getConversionFactor() { return conversionFactor; }

    public BigDecimal getPurchaseRate() { return purchaseRate; }

    public BigDecimal getMrp() { return mrp; }

    public BigDecimal getDiscount() { return discount; }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getCgst() { return cgst; }

    public BigDecimal getSgst() { return sgst; }

    public BigDecimal getAmount() { return amount; }

    public String getInventoryId() { return inventoryId; }
}
