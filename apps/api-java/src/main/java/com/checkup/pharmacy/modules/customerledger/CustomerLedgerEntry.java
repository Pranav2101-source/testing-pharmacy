package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.CustomerLedgerEntryType;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.generator.EventType;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Maps the Prisma `CustomerLedgerEntry` model (table "customer_ledger_entries") —
 * the customer-side mirror of {@link com.checkup.pharmacy.modules.supplierledger.SupplierLedgerEntry}.
 *
 * <p>Append-only: one immutable row per event that moves what a customer owes us
 * (dues) or what we hold for them (advance). Hence {@link CreatedAtEntity} — there
 * is no {@code updatedAt} column, because a correction here is a new opposing row,
 * never an edit. That is the whole point: {@code Customer.creditUsed} used to be a
 * scalar with four mutation points and no history, so once it drifted there was no
 * way to detect it, let alone repair it.
 *
 * <p>Rows are only ever created through {@code CustomerLedgerService}, which is
 * what guarantees the delta signs and the cached scalars on {@code Customer} agree
 * with the ledger. Nothing else should construct one — the factory here is
 * deliberately package-private.
 */
@Entity
@Table(name = "customer_ledger_entries")
public class CustomerLedgerEntry extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "customerId")
    private String customerId;

    @Column(name = "type")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private CustomerLedgerEntryType type;

    /** Null unless this entry is a numbered document the customer can be handed. */
    @Column(name = "entryNumber")
    private String entryNumber;

    /**
     * Positive magnitude — the money that moved, as printed on the voucher. Carries
     * no direction; see {@link #duesDelta} / {@link #advanceDelta} for that.
     */
    @Column(name = "amount")
    private BigDecimal amount;

    @Column(name = "duesDelta")
    private BigDecimal duesDelta;

    @Column(name = "advanceDelta")
    private BigDecimal advanceDelta;

    @Column(name = "duesBalanceAfter")
    private BigDecimal duesBalanceAfter;

    @Column(name = "advanceBalanceAfter")
    private BigDecimal advanceBalanceAfter;

    @Column(name = "invoiceId")
    private String invoiceId;

    @Column(name = "salesReturnId")
    private String salesReturnId;

    @Column(name = "paymentMode")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PaymentMode paymentMode;

    @Column(name = "reference")
    private String reference;

    @Column(name = "notes")
    private String notes;

    @Column(name = "entryAt")
    private Instant entryAt;

    /**
     * DB-assigned total order (BIGSERIAL), read back after insert — the only
     * generated-on-write column in this schema.
     *
     * <p>Not insertable: Postgres owns the sequence. {@code @Generated(INSERT)} is
     * what makes Hibernate re-read the value, so an entry returned straight from a
     * write has its seq populated rather than null.
     *
     * <p>Why it exists at all: {@code entryAt} defaults to CURRENT_TIMESTAMP, which
     * in Postgres is transaction-START time, so a bill posting SALE and
     * ADVANCE_APPLIED together stamps both rows with an IDENTICAL entryAt. Ordering
     * a statement by entryAt then fell through to the cuid id — alphabetical, not
     * chronological — which printed the SALE after the payment that settled it and
     * made every closing balance on the khata nonsense. Verified against a real
     * Postgres before this column was added.
     */
    @Generated(event = EventType.INSERT)
    @Column(name = "seq", insertable = false, updatable = false)
    private Long seq;

    @Column(name = "createdBy")
    private String createdBy;

    protected CustomerLedgerEntry() {
        // Required by JPA.
    }

    /**
     * Package-private on purpose: balances-after and the delta signs must be
     * computed by {@code CustomerLedgerService#post}, which holds the customer row
     * lock. A caller building one of these directly could write an entry whose
     * running balance disagrees with the cached scalar, which is precisely the class
     * of drift this table exists to make impossible.
     */
    static CustomerLedgerEntry create(String pharmacyId, String customerId, CustomerLedgerEntryType type,
                                      String entryNumber, BigDecimal amount, BigDecimal duesDelta,
                                      BigDecimal advanceDelta, BigDecimal duesBalanceAfter,
                                      BigDecimal advanceBalanceAfter, String invoiceId, String salesReturnId,
                                      PaymentMode paymentMode, String reference, String notes, Instant entryAt,
                                      String createdBy) {
        CustomerLedgerEntry e = new CustomerLedgerEntry();
        e.assignId(Cuid.generate());
        e.pharmacyId = pharmacyId;
        e.customerId = customerId;
        e.type = type;
        e.entryNumber = entryNumber;
        e.amount = amount;
        e.duesDelta = duesDelta;
        e.advanceDelta = advanceDelta;
        e.duesBalanceAfter = duesBalanceAfter;
        e.advanceBalanceAfter = advanceBalanceAfter;
        e.invoiceId = invoiceId;
        e.salesReturnId = salesReturnId;
        e.paymentMode = paymentMode;
        e.reference = reference;
        e.notes = notes;
        e.entryAt = entryAt != null ? entryAt : Instant.now();
        e.createdBy = createdBy;
        return e;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getCustomerId() { return customerId; }

    public CustomerLedgerEntryType getType() { return type; }

    public String getEntryNumber() { return entryNumber; }

    public BigDecimal getAmount() { return amount; }

    public BigDecimal getDuesDelta() { return duesDelta; }

    public BigDecimal getAdvanceDelta() { return advanceDelta; }

    public BigDecimal getDuesBalanceAfter() { return duesBalanceAfter; }

    public BigDecimal getAdvanceBalanceAfter() { return advanceBalanceAfter; }

    public String getInvoiceId() { return invoiceId; }

    public String getSalesReturnId() { return salesReturnId; }

    public PaymentMode getPaymentMode() { return paymentMode; }

    public String getReference() { return reference; }

    public String getNotes() { return notes; }

    public Instant getEntryAt() { return entryAt; }

    public Long getSeq() { return seq; }

    public String getCreatedBy() { return createdBy; }
}
