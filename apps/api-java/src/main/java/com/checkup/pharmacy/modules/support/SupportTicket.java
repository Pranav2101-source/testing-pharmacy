package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.TicketLanguage;
import com.checkup.pharmacy.common.enums.TicketPriority;
import com.checkup.pharmacy.common.enums.TicketSLA;
import com.checkup.pharmacy.common.enums.TicketStatus;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/** A support ticket (table "support_tickets") raised by a pharmacy user against the platform's support team. */
@Entity
@Table(name = "support_tickets")
public class SupportTicket extends BaseEntity {

    @Column(name = "ticketNumber")
    private String ticketNumber;

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "raisedById")
    private String raisedById;

    @Column(name = "categoryId")
    private String categoryId;

    @Column(name = "customTitle")
    private String customTitle;

    @Column(name = "assignedAgentId")
    private String assignedAgentId;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private TicketStatus status = TicketStatus.OPEN;

    @Column(name = "priority")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private TicketPriority priority = TicketPriority.MEDIUM;

    @Column(name = "sla")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private TicketSLA sla;

    @Column(name = "language")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private TicketLanguage language = TicketLanguage.ENGLISH;

    @Column(name = "dueDate")
    private Instant dueDate;

    @Column(name = "description")
    private String description;

    @Column(name = "mobile")
    private String mobile;

    @Column(name = "altMobile")
    private String altMobile;

    @Column(name = "resolvedAt")
    private Instant resolvedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pharmacyId", insertable = false, updatable = false)
    private Pharmacy pharmacy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "raisedById", insertable = false, updatable = false)
    private User raisedBy;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "categoryId", insertable = false, updatable = false)
    private TicketCategory category;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignedAgentId", insertable = false, updatable = false)
    private SupportAgent assignedAgent;

    protected SupportTicket() {
        // Required by JPA.
    }

    public static SupportTicket create(String ticketNumber, String pharmacyId, String raisedById, String categoryId,
                                       String customTitle, String assignedAgentId, TicketStatus status,
                                       TicketPriority priority, TicketSLA sla, TicketLanguage language,
                                       Instant dueDate, String description, String mobile, String altMobile) {
        SupportTicket t = new SupportTicket();
        t.assignId(Cuid.generate());
        t.ticketNumber = ticketNumber;
        t.pharmacyId = pharmacyId;
        t.raisedById = raisedById;
        t.categoryId = categoryId;
        t.customTitle = customTitle;
        t.assignedAgentId = assignedAgentId;
        t.status = status;
        t.priority = priority == null ? TicketPriority.MEDIUM : priority;
        t.sla = sla;
        t.language = language == null ? TicketLanguage.ENGLISH : language;
        t.dueDate = dueDate;
        t.description = description;
        t.mobile = mobile == null ? "" : mobile;
        t.altMobile = altMobile;
        return t;
    }

    public void updateStatus(TicketStatus status) {
        this.status = status;
        if (status == TicketStatus.RESOLVED) {
            this.resolvedAt = Instant.now();
        }
    }

    public void assign(String agentId) {
        this.assignedAgentId = agentId;
        this.status = agentId != null ? TicketStatus.ASSIGNED : TicketStatus.OPEN;
    }

    public String getTicketNumber() { return ticketNumber; }

    public String getPharmacyId() { return pharmacyId; }

    public String getRaisedById() { return raisedById; }

    public String getCategoryId() { return categoryId; }

    public String getCustomTitle() { return customTitle; }

    public String getAssignedAgentId() { return assignedAgentId; }

    public TicketStatus getStatus() { return status; }

    public TicketPriority getPriority() { return priority; }

    public TicketSLA getSla() { return sla; }

    public TicketLanguage getLanguage() { return language; }

    public Instant getDueDate() { return dueDate; }

    public String getDescription() { return description; }

    public String getMobile() { return mobile; }

    public String getAltMobile() { return altMobile; }

    public Instant getResolvedAt() { return resolvedAt; }

    public Pharmacy getPharmacy() { return pharmacy; }

    public User getRaisedBy() { return raisedBy; }

    public TicketCategory getCategory() { return category; }

    public SupportAgent getAssignedAgent() { return assignedAgent; }
}
