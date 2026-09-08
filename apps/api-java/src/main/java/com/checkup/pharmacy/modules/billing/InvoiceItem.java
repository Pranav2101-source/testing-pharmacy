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

    /**
     * {@code PACK} (default, every legacy line) — {@link #quantity} is whole
     * strips/bottles and {@link #mrp}/{@link #rate} are the printed pack price.
     * {@code LOOSE} — {@link #quantity} is individual pieces and mrp/rate are
     * per-piece (pack MRP / unitsPerPack). {@link #batchNumber}/{@link #expiryDate}
     * are still carried; a cut-strip sale must show them.
     */
    @Column(name = "saleUnit")
    private String saleUnit = "PACK";

    /** Base-unit snapshot for a loose line ("TABLET" etc.) — the "8 tab" label on a re-print. */
    @Column(name = "baseUnit")
    private String baseUnit;

    /**
     * Scheme quantity given free with this line (10+1, buy-100-get-10).
     *
     * <p>Not charged — {@code taxableAmount} and {@code amount} are derived from
     * {@link #quantity} alone. It IS deducted from stock: the goods physically leave
     * the shelf, so the batch is decremented by {@code quantity + freeQty}.
     */
    @Column(name = "freeQty")
    private int freeQty;

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

    /**
     * {@code true} — the dispensing engine chose this batch under the invoice's
     * strategy (see {@link Invoice#getDispensingStrategy()}). {@code false} — a
     * pharmacist overrode it in the batch picker. Part of the dispensing audit
     * trail. Defaults {@code true}: legacy lines predate the picker override flag.
     */
    @Column(name = "batchAutoSelected")
    private boolean batchAutoSelected = true;

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
                                     int freeQty,
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
        item.freeQty = freeQty;
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

    /**
     * Marks this line as a loose (cut-strip) sale — {@code quantity} is pieces and
     * the money figures on it are per-piece. Chainable off {@link #create}; the
     * default without it is {@code PACK}. {@code baseUnit} is the piece unit at sale
     * time, snapshotted for the re-print label.
     */
    public InvoiceItem asLooseSale(String baseUnit) {
        this.saleUnit = "LOOSE";
        this.baseUnit = baseUnit;
        return this;
    }

    /**
     * Records whether the engine picked this batch ({@code true}) or a pharmacist
     * overrode it ({@code false}). Chainable off {@link #create}; defaults {@code true}.
     */
    public InvoiceItem withBatchAutoSelected(boolean autoSelected) {
        this.batchAutoSelected = autoSelected;
        return this;
    }

    public boolean isBatchAutoSelected() { return batchAutoSelected; }

    public String getPharmacyId() { return pharmacyId; }

    public String getInvoiceId() { return invoiceId; }

    public String getInventoryId() { return inventoryId; }

    public String getMedicineName() { return medicineName; }

    public String getHsnCode() { return hsnCode; }

    public String getBatchNumber() { return batchNumber; }

    public Instant getExpiryDate() { return expiryDate; }

    public int getQuantity() { return quantity; }

    public String getSaleUnit() { return saleUnit; }

    public String getBaseUnit() { return baseUnit; }

    public boolean isLooseSale() { return "LOOSE".equals(saleUnit); }

    public int getFreeQty() { return freeQty; }

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
