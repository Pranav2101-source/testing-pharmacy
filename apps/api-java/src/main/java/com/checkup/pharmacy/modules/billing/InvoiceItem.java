package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.domain.IdOnlyEntity;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.inventory.Inventory;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;

/** Maps the Prisma `InvoiceItem` model (table "invoice_items") — one sold batch line. */
@Entity
@Table(name = "invoice_items")
public class InvoiceItem extends IdOnlyEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "invoiceId")
    private String invoiceId;

    @Column(name = "inventoryId")
    private String inventoryId;

    @Column(name = "medicineName")
    private String medicineName;

    @Column(name = "hsnCode")
    private String hsnCode;

    @Column(name = "batchNumber")
    private String batchNumber;

    @Column(name = "expiryDate")
    private Instant expiryDate;

    @Column(name = "quantity")
    private int quantity;

    @Column(name = "mrp")
    private BigDecimal mrp;

    @Column(name = "rate")
    private BigDecimal rate;

    @Column(name = "purchaseRate")
    private BigDecimal purchaseRate = BigDecimal.ZERO;

    @Column(name = "discount")
    private BigDecimal discount = BigDecimal.ZERO;

    @Column(name = "gstRate")
    private BigDecimal gstRate;

    @Column(name = "cgst")
    private BigDecimal cgst;

    @Column(name = "sgst")
    private BigDecimal sgst;

    @Column(name = "igst")
    private BigDecimal igst = BigDecimal.ZERO;

    @Column(name = "taxableAmount")
    private BigDecimal taxableAmount;

    @Column(name = "amount")
    private BigDecimal amount;

    @Column(name = "location")
    private String location;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "inventoryId", insertable = false, updatable = false)
    private Inventory inventory;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "invoiceId", insertable = false, updatable = false)
    private Invoice invoice;

    protected InvoiceItem() {
        // Required by JPA.
    }

    public static InvoiceItem create(String pharmacyId, String invoiceId, String inventoryId, String medicineName,
                                     String hsnCode, String batchNumber, Instant expiryDate, int quantity,
                                     BigDecimal mrp, BigDecimal rate, BigDecimal purchaseRate, BigDecimal discount,
                                     BigDecimal gstRate, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                     BigDecimal taxableAmount, BigDecimal amount, String location) {
        InvoiceItem item = new InvoiceItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.invoiceId = invoiceId;
        item.inventoryId = inventoryId;
        item.medicineName = medicineName;
        item.hsnCode = hsnCode;
        item.batchNumber = batchNumber;
        item.expiryDate = expiryDate;
        item.quantity = quantity;
        item.mrp = mrp;
        item.rate = rate;
        item.purchaseRate = purchaseRate;
        item.discount = discount;
        item.gstRate = gstRate;
        item.cgst = cgst;
        item.sgst = sgst;
        item.igst = igst;
        item.taxableAmount = taxableAmount;
        item.amount = amount;
        item.location = location;
        return item;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getInvoiceId() { return invoiceId; }

    public String getInventoryId() { return inventoryId; }

    public String getMedicineName() { return medicineName; }

    public String getHsnCode() { return hsnCode; }

    public String getBatchNumber() { return batchNumber; }

    public Instant getExpiryDate() { return expiryDate; }

    public int getQuantity() { return quantity; }

    public BigDecimal getMrp() { return mrp; }

    public BigDecimal getRate() { return rate; }

    public BigDecimal getPurchaseRate() { return purchaseRate; }

    public BigDecimal getDiscount() { return discount; }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getCgst() { return cgst; }

    public BigDecimal getSgst() { return sgst; }

    public BigDecimal getIgst() { return igst; }

    public BigDecimal getTaxableAmount() { return taxableAmount; }

    public BigDecimal getAmount() { return amount; }

    public String getLocation() { return location; }

    public Inventory getInventory() { return inventory; }

    public Invoice getInvoice() { return invoice; }
}
