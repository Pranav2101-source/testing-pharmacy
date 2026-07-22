package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Append-only rollback log (table "migration_created_records") — one row per record a session newly created. */
@Entity
@Table(name = "migration_created_records")
public class MigrationCreatedRecord extends CreatedAtEntity {

    @Column(name = "sessionId")
    private String sessionId;

    @Column(name = "entityType")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private MigrationEntityType entityType;

    @Column(name = "entityId")
    private String entityId;

    protected MigrationCreatedRecord() {
        // Required by JPA.
    }

    public static MigrationCreatedRecord create(String sessionId, MigrationEntityType entityType, String entityId) {
        MigrationCreatedRecord r = new MigrationCreatedRecord();
        r.assignId(Cuid.generate());
        r.sessionId = sessionId;
        r.entityType = entityType;
        r.entityId = entityId;
        return r;
    }

    public String getSessionId() { return sessionId; }

    public MigrationEntityType getEntityType() { return entityType; }

    public String getEntityId() { return entityId; }
}
