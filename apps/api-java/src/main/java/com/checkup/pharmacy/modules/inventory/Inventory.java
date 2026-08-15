package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.BatchStatus;
import com.checkup.pharmacy.common.util.Cuid;
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
 * Maps the Prisma `Inventory` model (table "inventory") — a physical stock batch.
 * One row per (medicine, batchNumber) per pharmacy; {@code quantity} is the
 * on-hand count and {@code reservedQuantity} is stock held by in-progress billing
 * sessions (see {@link StockReservation}) — available-to-sell is quantity minus
 * reservedQuantity, never a stored column, to avoid it drifting out of sync.
 */
@Entity
@Table(name = "inventory")
public class Inventory extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "medicineId")
    private String medicineId;

    @Column(name = "batchNumber")
    private String batchNumber;

    @Column(name = "expiryDate")
    private Instant expiryDate;

    @Column(name = "quantity")
    private int quantity;

    @Column(name = "reservedQuantity")
    private int reservedQuantity;

    @Column(name = "purchaseRate")
    private BigDecimal purchaseRate;

    @Column(name = "mrp")
    private BigDecimal mrp;

    @Column(name = "location")
    private String location;

    @Column(name = "shelfId")
    private String shelfId;

    @Column(name = "minimumStock")
    private int minimumStock = 10;

    @Column(name = "reorderLevel")
    private int reorderLevel = 5;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private BatchStatus status = BatchStatus.ACTIVE;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "medicineId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.medicine.Medicine medicine;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shelfId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.location.Shelf shelf;

    protected Inventory() {
        // Required by JPA.
    }

    public static Inventory create(String pharmacyId, String medicineId, String batchNumber, Instant expiryDate,
                                   int quantity, BigDecimal purchaseRate, BigDecimal mrp,
                                   int minimumStock, int reorderLevel) {
        Inventory inv = new Inventory();
        inv.assignId(Cuid.generate());
        inv.pharmacyId = pharmacyId;
        inv.medicineId = medicineId;
        inv.batchNumber = batchNumber;
        inv.expiryDate = expiryDate;
        inv.quantity = quantity;
        inv.purchaseRate = purchaseRate;
        inv.mrp = mrp;
        inv.minimumStock = minimumStock;
        inv.reorderLevel = reorderLevel;
        inv.status = BatchStatus.ACTIVE;
        return inv;
    }

    /** Merges an incoming delivery into this existing batch (Add Stock / GRN confirm). */
    public void mergeIncoming(int addedQuantity, BigDecimal purchaseRate, BigDecimal mrp, Instant expiryDate) {
        this.quantity += addedQuantity;
        this.purchaseRate = purchaseRate;
        this.mrp = mrp;
        this.expiryDate = expiryDate;
        this.status = BatchStatus.ACTIVE;
    }

    /** Sets absolute quantity — used by adjustments and stock-audit approval, which compute the target themselves. */
    public void setQuantity(int quantity) {
        this.quantity = quantity;
    }

    public void setStatus(BatchStatus status) {
        this.status = status;
    }

    /**
     * Takes an expired batch off the books: no stock left, and marked EXPIRED for good.
     *
     * <p>This is the code path {@link BatchStatus#EXPIRED} was always meant to have.
     * {@code InventoryService.applyStatusChange} refuses to let anyone set EXPIRED by hand,
     * saying it "is set automatically" — but nothing set it, and {@code MovementType.EXPIRY_REMOVAL}
     * sat declared and unused. So expired medicine kept its quantity and its full cost for ever:
     * it inflated the stock valuation, it counted as dead stock at cost, and the input tax credit
     * claimed on it was never reversed even though section 17(5)(h) blocks credit on goods that
     * are destroyed.
     *
     * <p>Reservations are cleared too. A reservation against stock that no longer exists would
     * keep the batch looking partly spoken-for on a row that has nothing left to give.
     *
     * @return the quantity written off, so the caller can record it on the movement
     */
    public int writeOffExpired() {
        int removed = this.quantity;
        this.quantity = 0;
        this.reservedQuantity = 0;
        this.status = BatchStatus.EXPIRED;
        return removed;
    }

    /** shelfId (structured) and location (free-text) are mutually exclusive; caller resolves which wins. */
    public void setPlacement(String shelfId, String location) {
        this.shelfId = shelfId;
        this.location = location;
    }

    public void reserve(int delta) {
        this.reservedQuantity = Math.max(0, this.reservedQuantity + delta);
    }

    public void setMinimumStock(int minimumStock) {
        this.minimumStock = minimumStock;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getMedicineId() { return medicineId; }

    public String getBatchNumber() { return batchNumber; }

    public Instant getExpiryDate() { return expiryDate; }

    public int getQuantity() { return quantity; }

    public int getReservedQuantity() { return reservedQuantity; }

    public BigDecimal getPurchaseRate() { return purchaseRate; }

    public BigDecimal getMrp() { return mrp; }

    public String getLocation() { return location; }

    public String getShelfId() { return shelfId; }

    public int getMinimumStock() { return minimumStock; }

    public int getReorderLevel() { return reorderLevel; }

    public BatchStatus getStatus() { return status; }

    public com.checkup.pharmacy.modules.medicine.Medicine getMedicine() { return medicine; }

    public com.checkup.pharmacy.modules.location.Shelf getShelf() { return shelf; }
}
