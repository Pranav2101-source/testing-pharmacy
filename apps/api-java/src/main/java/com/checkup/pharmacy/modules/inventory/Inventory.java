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
 *
 * <p>Exactly one of {@code medicine}/{@code localMedicine} is set (DB CHECK
 * constraint): a batch received for a medicine not yet in the global catalog
 * points at a {@link com.checkup.pharmacy.modules.medicine.PharmacyMedicine}
 * instead — see that class's javadoc. GRN receiving must never block on
 * catalog matching.
 */
@Entity
@Table(name = "inventory")
public class Inventory extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "medicineId")
    private String medicineId;

    /** Exactly one of medicineId/localMedicineId is set (DB CHECK constraint) — see {@link com.checkup.pharmacy.modules.medicine.PharmacyMedicine}. */
    @Column(name = "localMedicineId")
    private String localMedicineId;

    @Column(name = "batchNumber")
    private String batchNumber;

    @Column(name = "expiryDate")
    private Instant expiryDate;

    @Column(name = "quantity")
    private int quantity;

    /**
     * Loose pieces left over from a pack broken open for a cut-strip sale. Always
     * {@code < unitsPerPack}. Total pieces on hand = {@code quantity * unitsPerPack
     * + looseUnits}. Zero for every pack-only medicine; see {@link #dispenseLoose}.
     */
    @Column(name = "looseUnits")
    private int looseUnits;

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
    @JoinColumn(name = "localMedicineId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.medicine.PharmacyMedicine localMedicine;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shelfId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.location.Shelf shelf;

    protected Inventory() {
        // Required by JPA.
    }

    /** The ordinary path: stock received against a real global catalogue medicine. */
    public static Inventory create(String pharmacyId, String medicineId, String batchNumber, Instant expiryDate,
                                   int quantity, BigDecimal purchaseRate, BigDecimal mrp,
                                   int minimumStock, int reorderLevel) {
        return create(pharmacyId, medicineId, null, batchNumber, expiryDate, quantity, purchaseRate, mrp,
                minimumStock, reorderLevel);
    }

    /** GRN received a medicine not yet in the global catalogue — see {@link com.checkup.pharmacy.modules.medicine.PharmacyMedicine}. Exactly one of medicineId/localMedicineId is set. */
    public static Inventory create(String pharmacyId, String medicineId, String localMedicineId, String batchNumber,
                                   Instant expiryDate, int quantity, BigDecimal purchaseRate, BigDecimal mrp,
                                   int minimumStock, int reorderLevel) {
        if ((medicineId == null) == (localMedicineId == null)) {
            throw new IllegalArgumentException("Exactly one of medicineId/localMedicineId must be set");
        }
        Inventory inv = new Inventory();
        inv.assignId(Cuid.generate());
        inv.pharmacyId = pharmacyId;
        inv.medicineId = medicineId;
        inv.localMedicineId = localMedicineId;
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

    /**
     * Sets absolute loose-piece count — the stock-audit counterpart of {@link #setQuantity},
     * for the same reason: an approved audit sets the batch to exactly what was physically
     * counted, not "current + delta" (a sale between the count and the approval must not
     * corrupt the result). Unlike {@link #dispenseLoose}/{@link #restockLoose}, this does not
     * touch {@code quantity} — a stock count corrects the two independently.
     */
    public void setLooseUnits(int looseUnits) {
        this.looseUnits = looseUnits;
    }

    /**
     * Total individual pieces on hand — sealed packs plus the loose remainder from
     * an already-opened pack. {@code unitsPerPack} comes from the catalogue medicine;
     * pass 1 (or anything &lt;= 1) for a medicine with no pack multiple, and the
     * result is just {@code quantity}.
     */
    public long availablePieces(int unitsPerPack) {
        int upp = Math.max(1, unitsPerPack);
        return (long) quantity * upp + looseUnits;
    }

    /**
     * Removes {@code pieces} individual units for a loose (cut-strip) sale: draws
     * from the open-pack remainder first, then breaks as many sealed packs as
     * needed and keeps the leftover in {@link #looseUnits}.
     *
     * <p>The caller is expected to have taken the batch row lock and checked
     * {@link #availablePieces(int)} first. The guard here is a backstop: it throws a
     * plain {@link IllegalStateException} rather than letting the write reach the
     * database and fail as an opaque {@code inventory_looseUnits_nonneg} /
     * {@code quantity >= 0} constraint violation the caller cannot explain.
     */
    public void dispenseLoose(int pieces, int unitsPerPack) {
        int upp = Math.max(1, unitsPerPack);
        if (pieces <= 0) {
            return; // nothing to dispense — a zero/negative line is rejected upstream
        }
        if (pieces > availablePieces(upp)) {
            throw new IllegalStateException("dispenseLoose(" + pieces + ") exceeds the " + availablePieces(upp)
                    + " piece(s) on batch " + batchNumber + " — availability must be checked under lock before calling");
        }
        int fromLoose = Math.min(looseUnits, pieces);
        int stillNeeded = pieces - fromLoose;
        int packsToBreak = (stillNeeded + upp - 1) / upp; // ceil
        this.quantity -= packsToBreak;
        this.looseUnits = looseUnits - fromLoose + packsToBreak * upp - stillNeeded;
    }

    /**
     * Puts {@code pieces} loose units back on the shelf — the reversal of a loose
     * sale on a cancellation. They return as loose (the strip was already cut and
     * cannot be re-sealed), so this only grows {@link #looseUnits}; total pieces on
     * hand rises by exactly {@code pieces}. {@code looseUnits} may briefly exceed a
     * pack's worth, which self-corrects as later loose sales draw it down.
     */
    public void restockLoose(int pieces) {
        if (pieces <= 0) {
            return;
        }
        this.looseUnits += pieces;
        this.status = BatchStatus.ACTIVE;
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
        // An opened pack's remaining loose pieces expire with the batch. The
        // movement records `removed` in packs; the loose remainder is a sub-pack
        // amount the MVP does not value separately (see Track B).
        this.looseUnits = 0;
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

    public String getLocalMedicineId() { return localMedicineId; }

    public String getBatchNumber() { return batchNumber; }

    public Instant getExpiryDate() { return expiryDate; }

    public int getQuantity() { return quantity; }

    public int getLooseUnits() { return looseUnits; }

    public int getReservedQuantity() { return reservedQuantity; }

    public BigDecimal getPurchaseRate() { return purchaseRate; }

    public BigDecimal getMrp() { return mrp; }

    public String getLocation() { return location; }

    public String getShelfId() { return shelfId; }

    public int getMinimumStock() { return minimumStock; }

    public int getReorderLevel() { return reorderLevel; }

    public BatchStatus getStatus() { return status; }

    public com.checkup.pharmacy.modules.medicine.Medicine getMedicine() { return medicine; }

    public com.checkup.pharmacy.modules.medicine.PharmacyMedicine getLocalMedicine() { return localMedicine; }

    public com.checkup.pharmacy.modules.location.Shelf getShelf() { return shelf; }

    // ── Resolved product info — from the linked catalogue medicine, else the local
    // one (see PharmacyMedicine). Billing/reporting should read these instead of
    // dereferencing getMedicine() directly, so a batch received for a medicine not
    // yet in the global catalogue stays fully sellable. A local medicine has no
    // deactivate flow (always "active") and no loose-sale support yet (unitsPerPack
    // is always null for one, same as an unclassified catalogue medicine today). ──

    /** The id of whichever product this batch actually resolved against — global or local. */
    public String productId() {
        if (medicine != null) return medicine.getId();
        return localMedicine != null ? localMedicine.getId() : null;
    }

    public String productName() {
        if (medicine != null) return medicine.getName();
        return localMedicine != null ? localMedicine.getName() : null;
    }

    public String productGenericName() {
        if (medicine != null) return medicine.getGenericName();
        return localMedicine != null ? localMedicine.getGenericName() : null;
    }

    public String productHsnCode() {
        if (medicine != null) return medicine.getHsnCode();
        return localMedicine != null ? localMedicine.getHsnCode() : null;
    }

    public BigDecimal productGstRate() {
        if (medicine != null) return medicine.getGstRate();
        return localMedicine != null ? localMedicine.getGstRate() : null;
    }

    public String productSchedule() {
        if (medicine != null) return medicine.getSchedule();
        return localMedicine != null ? localMedicine.getSchedule() : null;
    }

    public String productForm() {
        if (medicine != null) return medicine.getForm();
        return localMedicine != null ? localMedicine.getForm() : null;
    }

    public String productStrength() {
        if (medicine != null) return medicine.getStrength();
        return localMedicine != null ? localMedicine.getStrength() : null;
    }

    /** A catalogue medicine can be deactivated; a local one cannot (no such flow yet), so it is always sellable. */
    public boolean productIsActive() {
        if (medicine != null) return medicine.isActive();
        return localMedicine != null;
    }

    /** Effective pack size for loose (cut-strip) selling — always null for a local medicine, which does not support it yet. */
    public Integer productUnitsPerPack() {
        return medicine != null ? medicine.getUnitsPerPack() : null;
    }

    public String productBaseUnit() {
        return medicine != null ? medicine.getBaseUnit() : null;
    }
}
