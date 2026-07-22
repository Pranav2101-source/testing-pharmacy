package com.checkup.pharmacy.modules.supplierledger;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.CreditNoteStatus;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.SupplierLedgerEntryType;
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

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Maps the Prisma `SupplierLedgerEntry` model (table "supplier_ledger_entries") —
 * merges what were two separate concerns (supplier payments, supplier credit
 * notes) into one table, discriminated by {@code type}. PAYMENT rows use
 * {@code grnId}/{@code paymentMode}/{@code paidAt}; CREDIT_NOTE rows use
 * {@code supplierReturnId}/{@code status}/{@code issuedAt}. The two are exposed
 * as separate modules ({@link com.checkup.pharmacy.modules.supplierpayment},
 * {@link com.checkup.pharmacy.modules.suppliercreditnote}) with separate
 * services/controllers over this shared repository — every query filters by type.
 */
@Entity
@Table(name = "supplier_ledger_entries")
public class SupplierLedgerEntry extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "supplierId")
    private String supplierId;

    @Column(name = "type")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private SupplierLedgerEntryType type;

    @Column(name = "entryNumber")
    private String entryNumber;

    @Column(name = "amount")
    private BigDecimal amount;

    // PAYMENT-only
    @Column(name = "grnId")
    private String grnId;

    @Column(name = "paymentMode")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PaymentMode paymentMode;

    @Column(name = "paidAt")
    private Instant paidAt;

    // CREDIT_NOTE-only
    @Column(name = "supplierReturnId")
    private String supplierReturnId;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private CreditNoteStatus status;

    @Column(name = "issuedAt")
    private Instant issuedAt;

    @Column(name = "reference")
    private String reference;

    @Column(name = "notes")
    private String notes;

    @Column(name = "createdBy")
    private String createdBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "supplierId", insertable = false, updatable = false)
    private Supplier supplier;

    protected SupplierLedgerEntry() {
        // Required by JPA.
    }

    public static SupplierLedgerEntry createPayment(String pharmacyId, String supplierId, String entryNumber,
                                                     BigDecimal amount, String grnId, PaymentMode paymentMode,
                                                     String reference, String notes, Instant paidAt, String createdBy) {
        SupplierLedgerEntry e = new SupplierLedgerEntry();
        e.assignId(Cuid.generate());
        e.pharmacyId = pharmacyId;
        e.supplierId = supplierId;
        e.type = SupplierLedgerEntryType.PAYMENT;
        e.entryNumber = entryNumber;
        e.amount = amount;
        e.grnId = grnId;
        e.paymentMode = paymentMode;
        e.reference = reference;
        e.notes = notes;
        e.paidAt = paidAt != null ? paidAt : Instant.now();
        e.createdBy = createdBy;
        return e;
    }

    public static SupplierLedgerEntry createCreditNote(String pharmacyId, String supplierId, String entryNumber,
                                                        BigDecimal amount, String supplierReturnId, String reference,
                                                        String notes, Instant issuedAt, String createdBy) {
        SupplierLedgerEntry e = new SupplierLedgerEntry();
        e.assignId(Cuid.generate());
        e.pharmacyId = pharmacyId;
        e.supplierId = supplierId;
        e.type = SupplierLedgerEntryType.CREDIT_NOTE;
        e.entryNumber = entryNumber;
        e.amount = amount;
        e.supplierReturnId = supplierReturnId;
        e.status = CreditNoteStatus.PENDING;
        e.reference = reference;
        e.notes = notes;
        e.issuedAt = issuedAt != null ? issuedAt : Instant.now();
        e.createdBy = createdBy;
        return e;
    }

    public void updateCreditNoteStatus(CreditNoteStatus status, String notes) {
        this.status = status;
        if (notes != null) {
            this.notes = notes;
        }
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSupplierId() { return supplierId; }

    public SupplierLedgerEntryType getType() { return type; }

    public String getEntryNumber() { return entryNumber; }

    public BigDecimal getAmount() { return amount; }

    public String getGrnId() { return grnId; }

    public PaymentMode getPaymentMode() { return paymentMode; }

    public Instant getPaidAt() { return paidAt; }

    public String getSupplierReturnId() { return supplierReturnId; }

    public CreditNoteStatus getStatus() { return status; }

    public Instant getIssuedAt() { return issuedAt; }

    public String getReference() { return reference; }

    public String getNotes() { return notes; }

    public String getCreatedBy() { return createdBy; }

    public Supplier getSupplier() { return supplier; }
}
