package com.checkup.pharmacy.modules.quotation;

import com.checkup.pharmacy.common.domain.IdOnlyEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/** Maps the Prisma `QuotationItem` model (table "quotation_items") — one requested/quoted line item. */
@Entity
@Table(name = "quotation_items")
public class QuotationItem extends IdOnlyEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "quotationId")
    private String quotationId;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "medicineName")
    private String medicineName;

    @Column(name = "quantity")
    private int quantity;

    @Column(name = "quotedRate")
    private BigDecimal quotedRate;

    @Column(name = "mrp")
    private BigDecimal mrp;

    @Column(name = "gstRate")
    private BigDecimal gstRate = BigDecimal.valueOf(12);

    @Column(name = "discount")
    private BigDecimal discount = BigDecimal.ZERO;

    @Column(name = "notes")
    private String notes;

    protected QuotationItem() {
        // Required by JPA.
    }

    public static QuotationItem create(String pharmacyId, String quotationId, String medicineId, String medicineName,
                                       int quantity, BigDecimal quotedRate, BigDecimal mrp, BigDecimal gstRate,
                                       BigDecimal discount, String notes) {
        QuotationItem item = new QuotationItem();
        item.assignId(Cuid.generate());
        item.pharmacyId = pharmacyId;
        item.quotationId = quotationId;
        item.medicineId = medicineId;
        item.medicineName = medicineName;
        item.quantity = quantity;
        item.quotedRate = quotedRate;
        item.mrp = mrp;
        item.gstRate = gstRate;
        item.discount = discount;
        item.notes = notes;
        return item;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getQuotationId() { return quotationId; }

    public String getMedicineId() { return medicineId; }

    public String getMedicineName() { return medicineName; }

    public int getQuantity() { return quantity; }

    public BigDecimal getQuotedRate() { return quotedRate; }

    public BigDecimal getMrp() { return mrp; }

    public BigDecimal getGstRate() { return gstRate; }

    public BigDecimal getDiscount() { return discount; }

    public String getNotes() { return notes; }
}
