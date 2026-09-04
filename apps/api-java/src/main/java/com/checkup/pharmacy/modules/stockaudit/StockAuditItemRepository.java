package com.checkup.pharmacy.modules.stockaudit;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface StockAuditItemRepository extends JpaRepository<StockAuditItem, String> {

    @Query("""
            SELECT i FROM StockAuditItem i LEFT JOIN FETCH i.inventory inv LEFT JOIN FETCH inv.medicine
            WHERE i.sessionId = :sessionId ORDER BY i.createdAt ASC
            """)
    List<StockAuditItem> findBySessionIdOrderByCreatedAtAsc(@Param("sessionId") String sessionId);

    Optional<StockAuditItem> findByIdAndSessionId(String id, String sessionId);

    List<StockAuditItem> findByIdInAndSessionId(List<String> ids, String sessionId);

    long countBySessionIdAndCountedQtyIsNull(String sessionId);

    @Query("SELECT i.sessionId AS sessionId, COUNT(i) AS cnt FROM StockAuditItem i WHERE i.sessionId IN :sessionIds GROUP BY i.sessionId")
    List<SessionCountRow> countTotalBySessionIds(@Param("sessionIds") List<String> sessionIds);

    // "Has a variance" now means a pack variance OR a loose-remainder variance — a batch whose
    // sealed-pack count matched exactly but whose opened strip's remainder didn't (or vice
    // versa) is still a real discrepancy an audit must surface, not a silent match.

    @Query("""
            SELECT i FROM StockAuditItem i LEFT JOIN FETCH i.inventory inv LEFT JOIN FETCH inv.medicine
            WHERE i.sessionId = :sessionId
              AND ((i.varianceQty IS NOT NULL AND i.varianceQty <> 0)
                   OR (i.varianceLooseUnits IS NOT NULL AND i.varianceLooseUnits <> 0))
            ORDER BY i.createdAt ASC
            """)
    List<StockAuditItem> findVarianceItems(@Param("sessionId") String sessionId);

    @Query("SELECT i.sessionId AS sessionId, COUNT(i) AS cnt FROM StockAuditItem i WHERE i.sessionId IN :sessionIds AND i.countedQty IS NOT NULL GROUP BY i.sessionId")
    List<SessionCountRow> countCountedBySessionIds(@Param("sessionIds") List<String> sessionIds);

    @Query("""
            SELECT i.sessionId AS sessionId, COUNT(i) AS cnt FROM StockAuditItem i
            WHERE i.sessionId IN :sessionIds
              AND ((i.varianceQty IS NOT NULL AND i.varianceQty <> 0)
                   OR (i.varianceLooseUnits IS NOT NULL AND i.varianceLooseUnits <> 0))
            GROUP BY i.sessionId
            """)
    List<SessionCountRow> countVarianceBySessionIds(@Param("sessionIds") List<String> sessionIds);

    /**
     * Gain/loss valued at each item's purchase rate (cost basis), per session — powers the audit
     * P&L report. A positive variance (counted more than expected — a "found" surplus) is a gain;
     * a negative variance (shrinkage) is a loss. Joined to inventory (not left-joined) since a
     * variance item always references a real, already-existing batch snapshot.
     *
     * <p>A loose-piece variance is valued at the PER-PIECE purchase rate (pack rate ÷ effective
     * unitsPerPack) — this pharmacy's override when it has set one, else the catalogue's, same
     * as billing itself resolves it. {@code COALESCE(..., 1)} makes the division a no-op for a
     * pack-only medicine, where varianceLooseUnits is always 0 anyway.
     */
    @Query("""
            SELECT i.sessionId AS sessionId,
                   COALESCE(SUM(
                       (CASE WHEN i.varianceQty > 0 THEN i.varianceQty * inv.purchaseRate ELSE 0 END)
                     + (CASE WHEN i.varianceLooseUnits > 0
                             THEN i.varianceLooseUnits * inv.purchaseRate / COALESCE(o.unitsPerPack, m.unitsPerPack, 1) ELSE 0 END)
                   ), 0) AS gainValue,
                   COALESCE(SUM(
                       (CASE WHEN i.varianceQty < 0 THEN -i.varianceQty * inv.purchaseRate ELSE 0 END)
                     + (CASE WHEN i.varianceLooseUnits < 0
                             THEN -i.varianceLooseUnits * inv.purchaseRate / COALESCE(o.unitsPerPack, m.unitsPerPack, 1) ELSE 0 END)
                   ), 0) AS lossValue
            FROM StockAuditItem i JOIN i.inventory inv JOIN inv.medicine m
            LEFT JOIN PharmacyMedicineOverride o ON o.id.pharmacyId = i.pharmacyId AND o.id.medicineId = inv.medicineId
            WHERE i.sessionId IN :sessionIds
              AND ((i.varianceQty IS NOT NULL AND i.varianceQty <> 0)
                   OR (i.varianceLooseUnits IS NOT NULL AND i.varianceLooseUnits <> 0))
            GROUP BY i.sessionId
            """)
    List<SessionValueRow> sumVarianceValueBySessionIds(@Param("sessionIds") List<String> sessionIds);

    interface SessionCountRow {
        String getSessionId();
        long getCnt();
    }

    interface SessionValueRow {
        String getSessionId();
        java.math.BigDecimal getGainValue();
        java.math.BigDecimal getLossValue();
    }
}
