package com.checkup.pharmacy.modules.cashclosure;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.ClosureStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Maps the Prisma `CashClosure` model (table "cash_closures") — one row per
 * pharmacy per calendar day, reconciling cash drawer counts against the day's
 * invoice sales. {@code cashSales}/{@code upiSales}/... are pulled from
 * confirmed (non-cancelled) invoices at creation, not editable afterward.
 */
@Entity
@Table(name = "cash_closures")
public class CashClosure extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "userId")
    private String userId;

    @Column(name = "closureDate")
    private LocalDate closureDate;

    @Column(name = "openingCash")
    private BigDecimal openingCash = BigDecimal.ZERO;

    @Column(name = "cashSales")
    private BigDecimal cashSales = BigDecimal.ZERO;

    @Column(name = "upiSales")
    private BigDecimal upiSales = BigDecimal.ZERO;

    @Column(name = "cardSales")
    private BigDecimal cardSales = BigDecimal.ZERO;

    @Column(name = "creditSales")
    private BigDecimal creditSales = BigDecimal.ZERO;

    @Column(name = "walletSales")
    private BigDecimal walletSales = BigDecimal.ZERO;

    @Column(name = "expectedCash")
    private BigDecimal expectedCash = BigDecimal.ZERO;

    @Column(name = "actualCash")
    private BigDecimal actualCash = BigDecimal.ZERO;

    @Column(name = "variance")
    private BigDecimal variance = BigDecimal.ZERO;

    @Column(name = "notes")
    private String notes;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private ClosureStatus status = ClosureStatus.DRAFT;

    @Column(name = "closedAt")
    private Instant closedAt;

    protected CashClosure() {
        // Required by JPA.
    }

    public static CashClosure create(String pharmacyId, String userId, LocalDate closureDate, BigDecimal openingCash,
                                     BigDecimal cashSales, BigDecimal upiSales, BigDecimal cardSales,
                                     BigDecimal creditSales, BigDecimal walletSales, BigDecimal expectedCash,
                                     BigDecimal actualCash, BigDecimal variance, String notes) {
        CashClosure c = new CashClosure();
        c.assignId(Cuid.generate());
        c.pharmacyId = pharmacyId;
        c.userId = userId;
        c.closureDate = closureDate;
        c.openingCash = openingCash;
        c.cashSales = cashSales;
        c.upiSales = upiSales;
        c.cardSales = cardSales;
        c.creditSales = creditSales;
        c.walletSales = walletSales;
        c.expectedCash = expectedCash;
        c.actualCash = actualCash;
        c.variance = variance;
        c.notes = notes;
        c.status = ClosureStatus.DRAFT;
        return c;
    }

    public void applyDraftEdit(BigDecimal openingCash, BigDecimal actualCash, BigDecimal expectedCash,
                               BigDecimal variance, String notes) {
        this.openingCash = openingCash;
        this.actualCash = actualCash;
        this.expectedCash = expectedCash;
        this.variance = variance;
        if (notes != null) {
            this.notes = notes;
        }
    }

    /**
     * Re-states the day's takings from a freshly-read sales breakdown.
     *
     * <p>The figures captured at {@link #create} are only correct if nothing is sold
     * afterwards, which is not how a till is used — the closure is routinely opened
     * before the last customer. Refreshing them is what keeps `variance` a statement
     * about missing cash rather than about when someone happened to open the form.
     */
    public void restateSales(BigDecimal cashSales, BigDecimal upiSales, BigDecimal cardSales,
                             BigDecimal creditSales, BigDecimal walletSales) {
        this.cashSales = cashSales;
        this.upiSales = upiSales;
        this.cardSales = cardSales;
        this.creditSales = creditSales;
        this.walletSales = walletSales;
    }

    public void close(BigDecimal actualCash, BigDecimal expectedCash, BigDecimal variance, String notes) {
        this.actualCash = actualCash;
        this.expectedCash = expectedCash;
        this.variance = variance;
        if (notes != null) {
            this.notes = notes;
        }
        this.status = ClosureStatus.CLOSED;
        this.closedAt = Instant.now();
    }

    public void dispute() {
        this.status = ClosureStatus.DISPUTED;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getUserId() { return userId; }

    public LocalDate getClosureDate() { return closureDate; }

    public BigDecimal getOpeningCash() { return openingCash; }

    public BigDecimal getCashSales() { return cashSales; }

    public BigDecimal getUpiSales() { return upiSales; }

    public BigDecimal getCardSales() { return cardSales; }

    public BigDecimal getCreditSales() { return creditSales; }

    public BigDecimal getWalletSales() { return walletSales; }

    public BigDecimal getExpectedCash() { return expectedCash; }

    public BigDecimal getActualCash() { return actualCash; }

    public BigDecimal getVariance() { return variance; }

    public String getNotes() { return notes; }

    public ClosureStatus getStatus() { return status; }

    public Instant getClosedAt() { return closedAt; }
}
