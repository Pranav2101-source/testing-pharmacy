package com.checkup.pharmacy.common.domain;

import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

import java.time.Instant;

/**
 * Base for append-only entities that carry a cuid `id` and `createdAt` only —
 * no `updatedAt` column, because their Prisma model never declares one (e.g.
 * {@code InventoryMovement}, {@code StockReservation}, {@code GRNItem}: an
 * immutable ledger/snapshot row is never updated after insert). Do not use this
 * for anything that has a mutable lifecycle after creation — use
 * {@link BaseEntity} instead, or the write will 500 against a nonexistent
 * "updatedAt" column.
 *
 * Implements {@link Persistable} for the same reason as {@link BaseEntity} —
 * see its javadoc for why a manually-assigned id needs an explicit isNew flag.
 */
@MappedSuperclass
public abstract class CreatedAtEntity implements Persistable<String> {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "createdAt")
    private Instant createdAt;

    @Transient
    private boolean isNew = true;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = Cuid.generate();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        isNew = false;
    }

    protected void assignId(String id) {
        this.id = id;
    }

    @Override
    public String getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
