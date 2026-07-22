package com.checkup.pharmacy.modules.support;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneOffset;

/**
 * Global (not per-pharmacy) ticket-number counter, table "ticket_sequences" —
 * a single row keyed by the fixed id {@code TICKET_SEQ}. Unlike
 * {@link com.checkup.pharmacy.common.sequence.DocumentSequenceService}'s
 * per-pharmacy/kind/period composite key, the Prisma model here is just
 * {@code id, current} — support tickets are numbered platform-wide, not per
 * tenant — so this is a dedicated native-SQL upsert rather than a reuse of
 * that service.
 */
@Service
public class TicketSequenceService {

    private static final String SEQ_ID = "TICKET_SEQ";
    private static final String PREFIX = "SUP";

    @PersistenceContext
    private EntityManager em;

    @Transactional
    public String next() {
        Object result = em.createNativeQuery("""
                        INSERT INTO ticket_sequences ("id", "current")
                        VALUES (?1, 1)
                        ON CONFLICT ("id")
                        DO UPDATE SET "current" = ticket_sequences."current" + 1
                        RETURNING "current"
                        """)
                .setParameter(1, SEQ_ID)
                .getSingleResult();
        int seq = ((Number) result).intValue();
        int year = Instant.now().atZone(ZoneOffset.ofHoursMinutes(5, 30)).getYear();
        return PREFIX + "-" + year + "-" + String.format("%06d", seq);
    }
}
