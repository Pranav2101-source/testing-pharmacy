package com.checkup.pharmacy.modules.location;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/** Maps the Prisma `Shelf` model (table "shelves") — tenant-scoped; `code` is unique per pharmacy. */
@Entity
@Table(name = "shelves")
public class Shelf extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "rackId")
    private String rackId;

    @Column(name = "code")
    private String code;

    @Column(name = "level")
    private int level;

    @Column(name = "description")
    private String description;

    @Column(name = "isActive")
    private boolean isActive = true;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "rackId", insertable = false, updatable = false)
    private Rack rack;

    protected Shelf() {
        // Required by JPA.
    }

    public static Shelf create(String pharmacyId, String rackId, String code, int level) {
        Shelf s = new Shelf();
        s.assignId(Cuid.generate());
        s.pharmacyId = pharmacyId;
        s.rackId = rackId;
        s.code = code;
        s.level = level;
        s.isActive = true;
        return s;
    }

    public void applyFields(String code, Integer level, String description) {
        if (code != null) this.code = code;
        if (level != null) this.level = level;
        this.description = description;
    }

    public void setActive(boolean active) {
        this.isActive = active;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getRackId() { return rackId; }

    public String getCode() { return code; }

    public int getLevel() { return level; }

    public String getDescription() { return description; }

    public boolean isActive() { return isActive; }

    public Rack getRack() { return rack; }
}
