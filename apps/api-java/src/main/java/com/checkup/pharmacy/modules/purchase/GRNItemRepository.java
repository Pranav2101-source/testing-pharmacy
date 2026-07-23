package com.checkup.pharmacy.modules.purchase;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface GRNItemRepository extends JpaRepository<GRNItem, String> {

    List<GRNItem> findByGrnId(String grnId);

    List<GRNItem> findByGrnIdIn(List<String> grnIds);

    /**
     * Line-item counts for a page of GRNs in ONE query — the list view shows a count
     * per row but never the lines themselves, so fetching full items per GRN (an N+1)
     * just to call {@code .size()} was pure waste. Backed by the {@code grn_items(grnId)}
     * index.
     */
    @Query("SELECT i.grnId AS grnId, COUNT(i) AS cnt FROM GRNItem i "
            + "WHERE i.pharmacyId = :pharmacyId AND i.grnId IN :grnIds GROUP BY i.grnId")
    List<GrnItemCountRow> countByGrnIdIn(@Param("pharmacyId") String pharmacyId, @Param("grnIds") List<String> grnIds);

    interface GrnItemCountRow {
        String getGrnId();
        long getCnt();
    }

    void deleteByGrnId(String grnId);
}
