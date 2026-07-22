package com.checkup.pharmacy.modules.migration;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MigrationImportJobRepository extends JpaRepository<MigrationImportJob, String> {

    List<MigrationImportJob> findBySessionIdOrderByCreatedAtAsc(String sessionId);

    /**
     * Every COMPLETED job for a pharmacy whose session was NOT rolled back, newest first.
     * The service picks the latest per entity type in memory — simpler and just as cheap as a
     * correlated-subquery JPQL query, since one pharmacy's job history is never large.
     */
    @Query("""
            SELECT j FROM MigrationImportJob j JOIN MigrationSession s ON s.id = j.sessionId
            WHERE j.pharmacyId = :pharmacyId AND CAST(j.status AS string) = 'COMPLETED'
              AND CAST(s.status AS string) <> 'ROLLED_BACK'
            ORDER BY j.completedAt DESC
            """)
    List<MigrationImportJob> findCompletedNotRolledBack(@Param("pharmacyId") String pharmacyId);
}
