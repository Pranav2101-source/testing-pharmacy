package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.domain.IdOnlyEntity;
import com.checkup.pharmacy.common.enums.ReturnDisposition;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/** Maps the Prisma `SalesReturnItem` model (table "sales_return_items") — one returned line item. */
@Entity
@Table(name = "sales_return_items")
public class SalesReturnItem extends IdOnlyEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "returnId")
    private String returnId;

    @Column(name = "invoiceItemId")
    private String invoiceItemId;

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

    @Column(name = "disposition")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private ReturnDisposition disposition = ReturnDisposition.RESTOCK;

    protected SalesReturnItem() {
        // Required by JPA.
    }

    public static SalesReturnItem create(String pharmacyId, String returnId, String invoiceItemId,
                                         String inventoryId, String medicineName, String hsnCode,
                                         String batchNumber, Instant expiryDate, int quantity, BigDecimal mrp,
                                         BigDecimal rate, BigDecimal discount, BigDecimal gstRate, BigDecimal cgst,
                                         BigDecimal sgst, BigDecimal igst, BigDecimal taxableAmount,
                                         BigDecimal amount, ReturnDisposition disposition) {
        SalesReturnItem item = new SalesReturnItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.returnId = returnId;
        item.invoiceItemId = invoiceItemId;
        item.inventoryId = inventoryId;
        item.medicineName = medicineName;
        item.hsnCode = hsnCode;
        item.batchNumber = batchNumber;
        item.expiryDate = expiryDate;
        item.quantity = quantity;
        item.mrp = mrp;
        item.rate = rate;
        item.discount = discount;
        item.gstRate = gstRate;
        item.cgst = cgst;
        item.sgst = sgst;
        item.igst = igst;
        item.taxableAmount = taxableAmount;
        item.amount = amount;
        item.disposition = disposition;
        return item;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getReturnId() { return returnId; }

    public String getInvoiceItemId() { return invoiceItemId; }

    public String getInventoryId() { return inventoryId; }

    public String getMedicineName() { return medicineName; }

    public String getHsnCode() { return hsnCode; }

    public String getBatchNumber() { return batchNumber; }

    public Instant getExpiryDate() { return expiryDate; }

    public int getQuantity() { return quantity; }

    public BigDecimal getMrp() { return mrp; }

    public BigDecimal getRate() { return rate; }

    public BigDecimal getDiscount() { return discount; }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getCgst() { return cgst; }

    public BigDecimal getSgst() { return sgst; }

    public BigDecimal getIgst() { return igst; }

    public BigDecimal getTaxableAmount() { return taxableAmount; }

    public BigDecimal getAmount() { return amount; }

    public ReturnDisposition getDisposition() { return disposition; }
}
