package com.checkup.pharmacy.modules.quotation;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.QuotationStatus;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.supplier.Supplier;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * Maps the Prisma `Quotation` model (table "quotations") — a request for
 * quotation (RFQ) sent to a supplier. Multiple quotations for the same items
 * across suppliers allow price comparison before raising a PO (see
 * {@link QuotationService#compare} and {@link QuotationService#convertToPo}).
 */
@Entity
@Table(name = "quotations")
public class Quotation extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "supplierId")
    private String supplierId;

    @Column(name = "quotationNumber")
    private String quotationNumber;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private QuotationStatus status = QuotationStatus.DRAFT;

    @Column(name = "validUntil")
    private Instant validUntil;

    @Column(name = "notes")
    private String notes;

    @Column(name = "createdBy")
    private String createdBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "supplierId", insertable = false, updatable = false)
    private Supplier supplier;

    protected Quotation() {
        // Required by JPA.
    }

    public static Quotation create(String pharmacyId, String supplierId, String quotationNumber, String createdBy,
                                   Instant validUntil, String notes) {
        Quotation q = new Quotation();
        q.assignId(Cuid.generate());
        q.pharmacyId = pharmacyId;
        q.supplierId = supplierId;
        q.quotationNumber = quotationNumber;
        q.status = QuotationStatus.DRAFT;
        q.createdBy = createdBy;
        q.validUntil = validUntil;
        q.notes = notes;
        return q;
    }

    public void applyDraft(Instant validUntil, String notes) {
        this.validUntil = validUntil;
        this.notes = notes;
    }

    public void changeStatus(QuotationStatus status) {
        this.status = status;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSupplierId() { return supplierId; }

    public String getQuotationNumber() { return quotationNumber; }

    public QuotationStatus getStatus() { return status; }

    public Instant getValidUntil() { return validUntil; }

    public String getNotes() { return notes; }

    public String getCreatedBy() { return createdBy; }

    public Supplier getSupplier() { return supplier; }
}
