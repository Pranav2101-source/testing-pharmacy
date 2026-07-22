package com.checkup.pharmacy.modules.doctor;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** Maps the Prisma `Doctor` model (table "doctors") — tenant-scoped. */
@Entity
@Table(name = "doctors")
public class Doctor extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "name")
    private String name;

    @Column(name = "registrationNo")
    private String registrationNo;

    @Column(name = "specialty")
    private String specialty;

    @Column(name = "clinic")
    private String clinic;

    @Column(name = "phone")
    private String phone;

    @Column(name = "email")
    private String email;

    @Column(name = "address")
    private String address;

    @Column(name = "isActive")
    private boolean isActive = true;

    protected Doctor() {
        // Required by JPA.
    }

    public static Doctor create(String pharmacyId, String name) {
        Doctor d = new Doctor();
        d.assignId(Cuid.generate());
        d.pharmacyId = pharmacyId;
        d.name = name;
        d.isActive = true;
        return d;
    }

    public void applyFields(String name, String registrationNo, String specialty, String clinic,
                            String phone, String email, String address) {
        this.name = name;
        this.registrationNo = registrationNo;
        this.specialty = specialty;
        this.clinic = clinic;
        this.phone = phone;
        this.email = email;
        this.address = address;
    }

    public void activate() {
        this.isActive = true;
    }

    public void deactivate() {
        this.isActive = false;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getName() { return name; }

    public String getRegistrationNo() { return registrationNo; }

    public String getSpecialty() { return specialty; }

    public String getClinic() { return clinic; }

    public String getPhone() { return phone; }

    public String getEmail() { return email; }

    public String getAddress() { return address; }

    public boolean isActive() { return isActive; }
}
