package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Maps the Prisma `InventoryMovement` model (table "inventory_movements") — the
 * append-only stock ledger. Every quantity change on {@link Inventory} MUST write
 * exactly one row here in the same transaction, or the ledger silently drifts out
 * of sync with the batch it's supposed to explain.
 */
@Entity
@Table(name = "inventory_movements")
public class InventoryMovement extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "inventoryId")
    private String inventoryId;

    @Column(name = "userId")
    private String userId;

    @Column(name = "type")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private MovementType type;

    @Column(name = "direction")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private MovementDirection direction;

    @Column(name = "quantity")
    private int quantity;

    @Column(name = "quantityBefore")
    private int quantityBefore;

    @Column(name = "quantityAfter")
    private int quantityAfter;

    /** GRN | INVOICE | SALES_RETURN | SUPPLIER_RETURN | BATCH_RECALL | STATUS_CHANGE | STOCK_AUDIT | OPENING_BALANCE | ... */
    @Column(name = "referenceType")
    private String referenceType;

    @Column(name = "referenceId")
    private String referenceId;

    @Column(name = "notes")
    private String notes;

    /**
     * Set only on a loose (cut-strip) movement — the base unit ("TABLET" | "CAPSULE" |
     * "ML" | "GM" | "EACH") that {@code quantity}/{@code quantityBefore}/{@code
     * quantityAfter} are counted in for this row. {@code null} (every legacy row, every
     * pack movement) means the row is in whole packs.
     */
    @Column(name = "baseUnit")
    private String baseUnit;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "inventoryId", insertable = false, updatable = false)
    private Inventory inventory;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "userId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.user.User user;

    protected InventoryMovement() {
        // Required by JPA.
    }

    public static InventoryMovement record(String pharmacyId, String inventoryId, String userId,
                                           MovementType type, MovementDirection direction, int quantity,
                                           int quantityBefore, int quantityAfter,
                                           String referenceType, String referenceId, String notes) {
        InventoryMovement m = new InventoryMovement();
        m.assignId(Cuid.generate());
        m.pharmacyId = pharmacyId;
        m.inventoryId = inventoryId;
        m.userId = userId;
        m.type = type;
        m.direction = direction;
        m.quantity = quantity;
        m.quantityBefore = quantityBefore;
        m.quantityAfter = quantityAfter;
        m.referenceType = referenceType;
        m.referenceId = referenceId;
        m.notes = notes;
        return m;
    }

    /**
     * Marks this as a loose (cut-strip) movement whose quantities are counted in {@code baseUnit}
     * pieces, not packs. Chainable off {@link #record}; a no-op (row stays pack-scale) when
     * {@code baseUnit} is null.
     */
    public InventoryMovement inBaseUnit(String baseUnit) {
        this.baseUnit = baseUnit;
        return this;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getInventoryId() { return inventoryId; }

    public String getUserId() { return userId; }

    public MovementType getType() { return type; }

    public MovementDirection getDirection() { return direction; }

    public int getQuantity() { return quantity; }

    public int getQuantityBefore() { return quantityBefore; }

    public int getQuantityAfter() { return quantityAfter; }

    public String getReferenceType() { return referenceType; }

    public String getReferenceId() { return referenceId; }

    public String getNotes() { return notes; }

    /** Loose-movement base unit, or {@code null} when this row's quantities are in whole packs. */
    public String getBaseUnit() { return baseUnit; }

    public Inventory getInventory() { return inventory; }

    public com.checkup.pharmacy.modules.user.User getUser() { return user; }
}
