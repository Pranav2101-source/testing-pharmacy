package com.checkup.pharmacy.modules.location;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** Maps the Prisma `Rack` model (table "racks") — tenant-scoped; `code` is unique per pharmacy. */
@Entity
@Table(name = "racks")
public class Rack extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "code")
    private String code;

    @Column(name = "name")
    private String name;

    @Column(name = "aisle")
    private String aisle;

    @Column(name = "isActive")
    private boolean isActive = true;

    protected Rack() {
        // Required by JPA.
    }

    public static Rack create(String pharmacyId, String code, String name) {
        Rack r = new Rack();
        r.assignId(Cuid.generate());
        r.pharmacyId = pharmacyId;
        r.code = code;
        r.name = name;
        r.isActive = true;
        return r;
    }

    public void applyFields(String code, String name, String aisle) {
        if (code != null) this.code = code;
        if (name != null) this.name = name;
        this.aisle = aisle;
    }

    public void setActive(boolean active) {
        this.isActive = active;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getCode() { return code; }

    public String getName() { return name; }

    public String getAisle() { return aisle; }

    public boolean isActive() { return isActive; }
}
