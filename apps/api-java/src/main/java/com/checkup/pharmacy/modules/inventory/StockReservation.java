package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Maps the Prisma `StockReservation` model (table "stock_reservations"). Created
 * when a billing session adds an item to cart; released when the sale is saved,
 * the cart is cleared, or {@code expiresAt} passes. Prevents two operators from
 * selling the same last strip simultaneously.
 */
@Entity
@Table(name = "stock_reservations")
public class StockReservation extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "inventoryId")
    private String inventoryId;

    @Column(name = "sessionId")
    private String sessionId;

    @Column(name = "quantity")
    private int quantity;

    @Column(name = "expiresAt")
    private Instant expiresAt;

    protected StockReservation() {
        // Required by JPA.
    }

    public static StockReservation create(String pharmacyId, String inventoryId, String sessionId,
                                          int quantity, Instant expiresAt) {
        StockReservation r = new StockReservation();
        r.assignId(Cuid.generate());
        r.pharmacyId = pharmacyId;
        r.inventoryId = inventoryId;
        r.sessionId = sessionId;
        r.quantity = quantity;
        r.expiresAt = expiresAt;
        return r;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getInventoryId() { return inventoryId; }

    public String getSessionId() { return sessionId; }

    public int getQuantity() { return quantity; }

    public Instant getExpiresAt() { return expiresAt; }
}
