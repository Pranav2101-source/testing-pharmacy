package com.checkup.pharmacy.common.domain;

import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

import java.time.Instant;

/**
 * Base for entities that carry the common Prisma columns: a cuid string `id`,
 * `createdAt`, and `updatedAt`. Prisma set these app-side (no DB defaults for
 * cuid/@updatedAt), so we populate them here on write.
 *
 * Implements {@link Persistable} with an explicit transient {@code isNew} flag
 * because the id is assigned in application code (see {@code Cuid.generate()})
 * before the first save, not by a DB identity/sequence. Without this, Spring
 * Data's default "is this new?" check (id == null) sees a non-null id on a
 * brand-new entity and calls {@code em.merge()} instead of {@code em.persist()}
 * — merge() returns a *different* managed copy, silently leaving the original
 * object (and anything built from it, e.g. an API response) with unpopulated
 * createdAt/updatedAt. isNew() here is correct in both directions: true for an
 * object built via a static factory (never persisted), false once loaded from
 * the DB or once this instance has actually been inserted.
 *
 * Column names are camelCase to match Prisma's schema verbatim (see
 * application.yml — globally_quoted_identifiers + standard physical naming).
 */
@MappedSuperclass
public abstract class BaseEntity implements Persistable<String> {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "createdAt")
    private Instant createdAt;

    @Column(name = "updatedAt")
    private Instant updatedAt;

    @Transient
    private boolean isNew = true;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = Cuid.generate();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
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

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
