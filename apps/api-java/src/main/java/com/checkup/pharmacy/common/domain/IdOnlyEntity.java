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

/**
 * Base for entities whose Prisma model carries neither `createdAt` nor
 * `updatedAt` — only a cuid `id` (e.g. {@code BatchRecall}, which tracks its own
 * timestamp via `recalledAt` instead). Do not default to this for new entities;
 * check the Prisma model's actual columns first — most entities should extend
 * {@link BaseEntity} or {@link CreatedAtEntity}.
 *
 * Implements {@link Persistable} for the same reason as {@link BaseEntity} —
 * see its javadoc for why a manually-assigned id needs an explicit isNew flag.
 */
@MappedSuperclass
public abstract class IdOnlyEntity implements Persistable<String> {

    @Id
    @Column(name = "id")
    private String id;

    @Transient
    private boolean isNew = true;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = Cuid.generate();
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
}
