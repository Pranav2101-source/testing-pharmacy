package com.checkup.pharmacy.modules.supplier;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/**
 * Maps the Prisma `Supplier` model (table "suppliers") — tenant-scoped.
 * {@code ledgerBalance} is a running total owned exclusively by the purchases
 * (GRN confirm), supplier-returns, and supplier-payments modules — mutate it
 * only via {@link #adjustLedgerBalance(BigDecimal)}, never by reassigning the
 * field directly, so every write is traceable to one code path.
 */
@Entity
@Table(name = "suppliers")
public class Supplier extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "name")
    private String name;

    @Column(name = "gstin")
    private String gstin;

    @Column(name = "dlNumber")
    private String dlNumber;

    @Column(name = "phone")
    private String phone;

    @Column(name = "email")
    private String email;

    @Column(name = "address")
    private String address;

    @Column(name = "city")
    private String city;

    @Column(name = "state")
    private String state;

    @Column(name = "creditLimit")
    private BigDecimal creditLimit = BigDecimal.ZERO;

    @Column(name = "creditDays")
    private int creditDays = 30;

    @Column(name = "paymentTerms")
    private String paymentTerms;

    @Column(name = "isActive")
    private boolean isActive = true;

    // Positive = pharmacy owes supplier; negative = supplier owes pharmacy (over-payment / credit).
    // Incremented on GRN confirm, decremented on payment or confirmed supplier return.
    @Column(name = "ledgerBalance")
    private BigDecimal ledgerBalance = BigDecimal.ZERO;

    protected Supplier() {
        // Required by JPA.
    }

    public static Supplier create(String pharmacyId, String name) {
        Supplier s = new Supplier();
        s.assignId(Cuid.generate());
        s.pharmacyId = pharmacyId;
        s.name = name;
        s.creditLimit = BigDecimal.ZERO;
        s.creditDays = 30;
        s.isActive = true;
        return s;
    }

    public void applyFields(String name, String gstin, String dlNumber, String phone, String email,
                            String address, String city, String state, BigDecimal creditLimit,
                            int creditDays, String paymentTerms) {
        this.name = name;
        this.gstin = gstin;
        this.dlNumber = dlNumber;
        this.phone = phone;
        this.email = email;
        this.address = address;
        this.city = city;
        this.state = state;
        this.creditLimit = creditLimit;
        this.creditDays = creditDays;
        this.paymentTerms = paymentTerms;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getName() { return name; }

    public String getGstin() { return gstin; }

    public String getDlNumber() { return dlNumber; }

    public String getPhone() { return phone; }

    public String getEmail() { return email; }

    public String getAddress() { return address; }

    public String getCity() { return city; }

    public String getState() { return state; }

    public BigDecimal getCreditLimit() { return creditLimit; }

    public int getCreditDays() { return creditDays; }

    public String getPaymentTerms() { return paymentTerms; }

    public boolean isActive() { return isActive; }

    public BigDecimal getLedgerBalance() { return ledgerBalance; }

    /** delta > 0 increases what the pharmacy owes (e.g. GRN confirm); delta < 0 decreases it (payment, return). */
    public void adjustLedgerBalance(BigDecimal delta) {
        this.ledgerBalance = this.ledgerBalance.add(delta);
    }
}
