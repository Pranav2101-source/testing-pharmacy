package com.checkup.pharmacy.modules.calendar;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface CalendarEventRepository extends JpaRepository<CalendarEvent, String> {

    Optional<CalendarEvent> findByIdAndPharmacyId(String id, String pharmacyId);

    @Query("""
            SELECT e FROM CalendarEvent e
            WHERE e.pharmacyId = :pharmacyId AND e.date >= :from AND e.date <= :to
            ORDER BY e.date ASC
            """)
    List<CalendarEvent> findManualEventsInRange(@Param("pharmacyId") String pharmacyId,
                                                @Param("from") Instant from, @Param("to") Instant to);

    long countByPharmacyIdAndDateBetween(String pharmacyId, Instant from, Instant to);
}
