package com.checkup.pharmacy.modules.customer;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Maps the Prisma `Customer` model (table "customers") — tenant-scoped.
 * Soft-deleted via {@code deletedAt} (null = active); unlike User/Medicine there
 * is no {@code isActive} boolean on this table.
 */
@Entity
@Table(name = "customers")
public class Customer extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "name")
    private String name;

    @Column(name = "phone")
    private String phone;

    @Column(name = "email")
    private String email;

    @Column(name = "address")
    private String address;

    @Column(name = "state")
    private String state;

    @Column(name = "dateOfBirth")
    private Instant dateOfBirth;

    @Column(name = "gender")
    private String gender;

    @Column(name = "abhaNumber")
    private String abhaNumber;

    @Column(name = "cardNumber")
    private String cardNumber;

    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "customerType")
    private CustomerType customerType = CustomerType.WALK_IN;

    @Column(name = "defaultDiscount")
    private BigDecimal defaultDiscount = BigDecimal.ZERO;

    @Column(name = "creditLimit")
    private BigDecimal creditLimit = BigDecimal.ZERO;

    @Column(name = "creditUsed")
    private BigDecimal creditUsed = BigDecimal.ZERO;

    @Column(name = "notes")
    private String notes;

    @Column(name = "deletedAt")
    private Instant deletedAt;

    protected Customer() {
        // Required by JPA.
    }

    public static Customer create(String pharmacyId, String name) {
        Customer c = new Customer();
        c.assignId(Cuid.generate());
        c.pharmacyId = pharmacyId;
        c.name = name;
        c.customerType = CustomerType.WALK_IN;
        c.defaultDiscount = BigDecimal.ZERO;
        c.creditLimit = BigDecimal.ZERO;
        c.creditUsed = BigDecimal.ZERO;
        return c;
    }

    public void applyFields(String name, String phone, String email, String address, String state,
                            Instant dateOfBirth, String gender, String abhaNumber, String cardNumber,
                            CustomerType customerType, BigDecimal defaultDiscount, BigDecimal creditLimit,
                            String notes) {
        this.name = name;
        this.phone = phone;
        this.email = email;
        this.address = address;
        this.state = state;
        this.dateOfBirth = dateOfBirth;
        this.gender = gender;
        this.abhaNumber = abhaNumber;
        this.cardNumber = cardNumber;
        this.customerType = customerType;
        this.defaultDiscount = defaultDiscount;
        this.creditLimit = creditLimit;
        this.notes = notes;
    }

    public void softDelete() {
        this.deletedAt = Instant.now();
    }

    /** delta > 0 records a new credit sale; delta < 0 reverses one (payment, cancel, return). */
    public void adjustCreditUsed(BigDecimal delta) {
        this.creditUsed = this.creditUsed.add(delta);
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getName() { return name; }

    public String getPhone() { return phone; }

    public String getEmail() { return email; }

    public String getAddress() { return address; }

    public String getState() { return state; }

    public Instant getDateOfBirth() { return dateOfBirth; }

    public String getGender() { return gender; }

    public String getAbhaNumber() { return abhaNumber; }

    public String getCardNumber() { return cardNumber; }

    public CustomerType getCustomerType() { return customerType; }

    public BigDecimal getDefaultDiscount() { return defaultDiscount; }

    public BigDecimal getCreditLimit() { return creditLimit; }

    public BigDecimal getCreditUsed() { return creditUsed; }

    public String getNotes() { return notes; }
}
