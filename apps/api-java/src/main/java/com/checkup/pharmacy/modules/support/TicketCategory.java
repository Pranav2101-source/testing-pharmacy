package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** A support-ticket category (table "ticket_categories") — 7 rows pre-seeded by the schema migration itself. */
@Entity
@Table(name = "ticket_categories")
public class TicketCategory extends CreatedAtEntity {

    @Column(name = "name")
    private String name;

    @Column(name = "isActive")
    private boolean isActive = true;

    @Column(name = "sortOrder")
    private int sortOrder = 0;

    protected TicketCategory() {
        // Required by JPA.
    }

    public String getName() { return name; }

    public boolean isActive() { return isActive; }

    public int getSortOrder() { return sortOrder; }
}
