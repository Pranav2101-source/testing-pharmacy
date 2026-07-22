package com.checkup.pharmacy.modules.calendar;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.CalendarEventType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/** A manually-created reminder (table "calendar_events"). Auto-derived events (expiry/credit/PO) are never persisted here. */
@Entity
@Table(name = "calendar_events")
public class CalendarEvent extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "title")
    private String title;

    @Column(name = "description")
    private String description;

    @Column(name = "date")
    private Instant date;

    @Column(name = "endDate")
    private Instant endDate;

    @Column(name = "allDay")
    private boolean allDay = true;

    @Column(name = "type")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private CalendarEventType type = CalendarEventType.CUSTOM;

    @Column(name = "color")
    private String color;

    @Column(name = "relatedId")
    private String relatedId;

    @Column(name = "relatedType")
    private String relatedType;

    @Column(name = "isDone")
    private boolean isDone = false;

    @Column(name = "createdById")
    private String createdById;

    protected CalendarEvent() {
        // Required by JPA.
    }

    public static CalendarEvent create(String pharmacyId, String createdById, String title, String description,
                                       Instant date, Instant endDate, boolean allDay, CalendarEventType type,
                                       String color, String relatedId, String relatedType) {
        CalendarEvent e = new CalendarEvent();
        e.assignId(Cuid.generate());
        e.pharmacyId = pharmacyId;
        e.createdById = createdById;
        e.title = title;
        e.description = description;
        e.date = date;
        e.endDate = endDate;
        e.allDay = allDay;
        e.type = type == null ? CalendarEventType.CUSTOM : type;
        e.color = color;
        e.relatedId = relatedId;
        e.relatedType = relatedType;
        return e;
    }

    public void applyUpdate(String title, String description, Instant date, Instant endDate, Boolean allDay,
                            Boolean isDone, String color) {
        if (title != null) this.title = title;
        if (description != null) this.description = description;
        if (date != null) this.date = date;
        if (endDate != null) this.endDate = endDate;
        if (allDay != null) this.allDay = allDay;
        if (isDone != null) this.isDone = isDone;
        if (color != null) this.color = color;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getTitle() { return title; }

    public String getDescription() { return description; }

    public Instant getDate() { return date; }

    public Instant getEndDate() { return endDate; }

    public boolean isAllDay() { return allDay; }

    public CalendarEventType getType() { return type; }

    public String getColor() { return color; }

    public String getRelatedId() { return relatedId; }

    public String getRelatedType() { return relatedType; }

    public boolean isDone() { return isDone; }

    public String getCreatedById() { return createdById; }
}
