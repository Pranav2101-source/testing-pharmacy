package com.checkup.pharmacy.modules.platform.domain;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * A change record for one subscription (table "subscription_audit_logs"):
 * PLAN_CHANGED, RENEWED, PAUSED, RESUMED, CANCELLED, INVOICE_GENERATED,
 * REMINDER_SENT. Separate from the platform-wide {@code audit_logs} (C24) — this
 * is a focused per-subscription history surfaced in the subscription drawer.
 *
 * {@code oldValue}/{@code newValue} are plain {@code String} (nullable): the
 * Prisma model stores them as JSON <em>text</em> columns, not {@code jsonb}, so
 * we serialize to a JSON string at the call site rather than mapping a JSON tree.
 */
@Entity
@Table(name = "subscription_audit_logs")
public class SubscriptionAuditLog extends CreatedAtEntity {

    @Column(name = "subscriptionId")
    private String subscriptionId;

    @Column(name = "action")
    private String action;

    @Column(name = "oldValue")
    private String oldValue;

    @Column(name = "newValue")
    private String newValue;

    @Column(name = "performedBy")
    private String performedBy;

    protected SubscriptionAuditLog() {
        // Required by JPA.
    }

    public static SubscriptionAuditLog create(String subscriptionId, String action, String oldValue,
                                              String newValue, String performedBy) {
        SubscriptionAuditLog a = new SubscriptionAuditLog();
        a.assignId(Cuid.generate());
        a.subscriptionId = subscriptionId;
        a.action = action;
        a.oldValue = oldValue;
        a.newValue = newValue;
        a.performedBy = performedBy;
        return a;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getSubscriptionId() { return subscriptionId; }

    public String getAction() { return action; }

    public String getOldValue() { return oldValue; }

    public String getNewValue() { return newValue; }

    public String getPerformedBy() { return performedBy; }
}
