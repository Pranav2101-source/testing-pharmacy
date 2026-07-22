package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;

/** A support-team member (table "support_agents") — always a {@link User} with role SUPPORT_AGENT. */
@Entity
@Table(name = "support_agents")
public class SupportAgent extends BaseEntity {

    @Column(name = "userId")
    private String userId;

    @Column(name = "isActive")
    private boolean isActive = true;

    @Column(name = "lastAssignedAt")
    private Instant lastAssignedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "userId", insertable = false, updatable = false)
    private User user;

    protected SupportAgent() {
        // Required by JPA.
    }

    public static SupportAgent create(String userId) {
        SupportAgent a = new SupportAgent();
        a.assignId(Cuid.generate());
        a.userId = userId;
        return a;
    }

    public void markAssigned() {
        this.lastAssignedAt = Instant.now();
    }

    public void setActive(boolean active) {
        this.isActive = active;
    }

    public String getUserId() { return userId; }

    public boolean isActive() { return isActive; }

    public Instant getLastAssignedAt() { return lastAssignedAt; }

    public User getUser() { return user; }
}
