package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.tax.TaxabilitySplitRow;
import com.checkup.pharmacy.modules.supplier.Supplier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.util.List;

public interface GRNItemRepository extends JpaRepository<GRNItem, String> {

    List<GRNItem> findByGrnId(String grnId);

    List<GRNItem> findByGrnIdIn(List<String> grnIds);

    // ── Purchase cost analysis ────────────────────────────────────────────────

    interface CostAnalysisRow {
        /** Effective medicine id — the catalogue id, or the local-medicine id when unlinked. */
        String getMedicineId();
        String getMedicineName();
        long getTotalQty();
        java.math.BigDecimal getTotalCost();
        java.math.BigDecimal getTotalMrpValue();
        long getBatches();
    }

    interface CostAnalysisTotalsRow {
        java.math.BigDecimal getTotalCost();
        java.math.BigDecimal getTotalMrpValue();
        long getMedicineCount();
    }

    /**
     * Purchase cost analysis, one row per medicine, aggregated and bounded BY THE DATABASE.
     *
     * <p>Previously the service loaded every GRN line for every confirmed receipt in the range
     * into memory and grouped them in Java — unbounded by anything but how much a pharmacy
     * bought, on a screen a pharmacist can point at a year. GROUP BY collapses it to one row
     * per medicine (tens, not tens of thousands) and {@code Limit} keeps only the biggest
     * spends, which is all the table shows.
     *
     * <p>Grouped on {@code COALESCE(medicineId, localMedicineId)} so a pharmacy's own
     * not-yet-catalogued medicines (see {@link com.checkup.pharmacy.modules.medicine.PharmacyMedicine})
     * each get their own row — the old null {@code medicineId} key merged every one of them
     * into a single mislabelled line. {@code MAX(medicineName)} because a medicine renamed
     * between two receipts still has one identity.
     */
    @Query("""
            SELECT COALESCE(i.medicineId, i.localMedicineId) AS medicineId,
                   MAX(i.medicineName) AS medicineName,
                   COALESCE(SUM(i.receivedQty + i.freeQty), 0) AS totalQty,
                   COALESCE(SUM(i.amount), 0) AS totalCost,
                   COALESCE(SUM(i.mrp * (i.receivedQty + i.freeQty)), 0) AS totalMrpValue,
                   COUNT(DISTINCT i.grnId) AS batches
            FROM GRNItem i
            JOIN GoodsReceiptNote g ON g.id = i.grnId
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.confirmedAt >= :from AND g.confirmedAt <= :to
            GROUP BY COALESCE(i.medicineId, i.localMedicineId)
            ORDER BY SUM(i.amount) DESC
            """)
    List<CostAnalysisRow> costAnalysisByMedicine(@Param("pharmacyId") String pharmacyId,
                                                 @Param("from") java.time.Instant from,
                                                 @Param("to") java.time.Instant to,
                                                 org.springframework.data.domain.Limit limit);

    /**
     * Grand totals for the whole confirmed-purchase period — the figure the summary cards
     * show. Deliberately separate from {@link #costAnalysisByMedicine}: the table is a
     * top-N, but "total purchased this period" must be every rupee, or it disagrees with the
     * Purchase page's own spend figure (which is a plain {@code SUM(totalAmount)}).
     */
    @Query("""
            SELECT COALESCE(SUM(i.amount), 0) AS totalCost,
                   COALESCE(SUM(i.mrp * (i.receivedQty + i.freeQty)), 0) AS totalMrpValue,
                   COUNT(DISTINCT COALESCE(i.medicineId, i.localMedicineId)) AS medicineCount
            FROM GRNItem i
            JOIN GoodsReceiptNote g ON g.id = i.grnId
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.confirmedAt >= :from AND g.confirmedAt <= :to
            """)
    CostAnalysisTotalsRow costAnalysisTotals(@Param("pharmacyId") String pharmacyId,
                                             @Param("from") java.time.Instant from,
                                             @Param("to") java.time.Instant to);

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

    // ── GSTR-3B input tax credit ───────────────────────────────────────────────

    /** Taxable half is the ITC in 4(A)(5), nil-rated half is exempt inward for table 5. */
    interface InwardSupplyRow extends TaxabilitySplitRow {
    }

    /**
     * Input tax credit for Table 4(A)(5), and exempt inward supplies for Table 5, in one pass.
     *
     * <p>Keyed on the GRN's {@code confirmedAt} — the moment the pharmacy accepted the goods —
     * rather than the supplier's invoice date. Credit is claimable once goods are received AND
     * the invoice is held, so the later of the two governs, and confirmation is the event this
     * system actually witnesses. A supplier invoice dated late in the previous month but
     * received in this one therefore falls in this period, which is correct.
     *
     * <p>CONFIRMED only. A draft GRN is goods the pharmacy has not accepted, and a cancelled
     * one never happened; claiming credit on either would be claiming it on a purchase that
     * does not exist.
     */
    @Query("""
            SELECT CASE WHEN i.gstRate > 0 THEN true ELSE false END AS taxable,
                   COALESCE(SUM(i.amount - i.cgst - i.sgst - i.igst), 0) AS taxableValue,
                   COALESCE(SUM(i.igst), 0) AS igst,
                   COALESCE(SUM(i.cgst), 0) AS cgst,
                   COALESCE(SUM(i.sgst), 0) AS sgst
            FROM GRNItem i
            JOIN GoodsReceiptNote g ON g.id = i.grnId
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.confirmedAt >= :from AND g.confirmedAt <= :to
            GROUP BY CASE WHEN i.gstRate > 0 THEN true ELSE false END
            """)
    List<InwardSupplyRow> inwardSuppliesByTaxability(@Param("pharmacyId") String pharmacyId,
                                                     @Param("from") java.time.Instant from,
                                                     @Param("to") java.time.Instant to);

    /**
     * Confirmed GRNs from an out-of-state supplier that carry no IGST — the tell-tale of a
     * purchase booked before this system could record inter-state tax.
     *
     * <p>These are NOT corrected automatically. The amounts may already sit behind a filed
     * return, so the sheet shows them to the accountant to adjust deliberately rather than
     * moving money between tax heads underneath them. See the 20260814000001 migration.
     *
     * <p>THE STATE COMPARISON IS CANONICALISED, and must stay in step with
     * {@code TaxJurisdiction.canonicalKey} — which is what decided the tax on these rows in
     * the first place. A plain {@code LOWER(s.state) <> LOWER(:pharmacyState)} disagreed with
     * it: a supplier recorded as "Tamilnadu" against a pharmacy in "Tamil Nadu" was booked
     * CGST+SGST by the calculator (correctly, once IndianState resolves both) and then
     * flagged HERE as a misclassified inter-state receipt. One typo produced a tax decision
     * and an accusation that the tax decision was wrong.
     *
     * <p>The caller passes {@code pharmacyStateKey} already canonicalised, so only one side
     * needs the replacements in SQL. The nested REPLACEs mirror {@code canonicalKey} exactly:
     * {@code &} → {@code and}, then space, hyphen and full stop removed, then lowercased. The
     * searches do not overlap, so order does not matter — but the SET must match, or a
     * receipt can be flagged by one and cleared by the other.
     *
     * <p>No index serves this expression, which costs nothing here: the query is already
     * bounded by a confirmed-GRN date range rather than by supplier state.
     */
    @Query("""
            SELECT g.grnNumber
            FROM GRNItem i
            JOIN GoodsReceiptNote g ON g.id = i.grnId
            JOIN Supplier s ON s.id = g.supplierId
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(g.status AS string) = 'CONFIRMED'
              AND g.confirmedAt >= :from AND g.confirmedAt <= :to
              AND i.gstRate > 0 AND i.igst = 0
              AND s.state IS NOT NULL AND TRIM(s.state) <> ''
              AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(s.state, '&', 'and'), ' ', ''), '-', ''), '.', ''))
                  <> :pharmacyStateKey
            GROUP BY g.grnNumber
            ORDER BY g.grnNumber
            """)
    List<String> misclassifiedInterstateGrns(@Param("pharmacyId") String pharmacyId,
                                             @Param("from") java.time.Instant from,
                                             @Param("to") java.time.Instant to,
                                             @Param("pharmacyStateKey") String pharmacyStateKey,
                                             org.springframework.data.domain.Limit limit);
}
