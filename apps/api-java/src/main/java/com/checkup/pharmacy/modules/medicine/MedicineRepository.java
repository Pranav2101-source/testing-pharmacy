package com.checkup.pharmacy.modules.medicine;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface MedicineRepository extends JpaRepository<Medicine, String> {

    /**
     * search is explicitly cast to string: a null :search bound into three
     * OR'd LOWER(CONCAT('%', :search, '%')) branches leaves Postgres unable to
     * infer the parameter's type ("function lower(bytea) does not exist") — see
     * InventoryRepository.search's javadoc for the full explanation.
     */
    @Query("""
            SELECT m FROM Medicine m
            WHERE (:search IS NULL
                   OR LOWER(m.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(m.genericName) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(m.manufacturer) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
              AND (:schedule IS NULL OR m.schedule = :schedule)
              AND (:form IS NULL OR m.form = :form)
              AND (:isActive IS NULL OR m.isActive = :isActive)
            """)
    Page<Medicine> search(@Param("search") String search,
                          @Param("schedule") String schedule,
                          @Param("form") String form,
                          @Param("isActive") Boolean isActive,
                          Pageable pageable);

    @Query("""
            SELECT COUNT(m) > 0 FROM Medicine m
            WHERE LOWER(m.name) = LOWER(:name)
              AND LOWER(COALESCE(m.manufacturer, '')) = LOWER(COALESCE(:manufacturer, ''))
              AND m.isActive = true
            """)
    boolean existsActiveDuplicate(@Param("name") String name, @Param("manufacturer") String manufacturer);

    /** Same duplicate check as {@link #existsActiveDuplicate}, excluding the row being edited — for update(). */
    @Query("""
            SELECT COUNT(m) > 0 FROM Medicine m
            WHERE LOWER(m.name) = LOWER(:name)
              AND LOWER(COALESCE(m.manufacturer, '')) = LOWER(COALESCE(:manufacturer, ''))
              AND m.isActive = true
              AND m.id <> :excludeId
            """)
    boolean existsActiveDuplicateExcludingId(@Param("name") String name, @Param("manufacturer") String manufacturer,
                                             @Param("excludeId") String excludeId);

    /**
     * Bulk-import support: fetches every active medicine whose name matches one of
     * the given (already-lowercased) names in a SINGLE query, so a 5,000-row
     * import does one duplicate lookup instead of 5,000 individual EXISTS checks.
     */
    @Query("SELECT m FROM Medicine m WHERE m.isActive = true AND LOWER(m.name) IN :lowerNames")
    List<Medicine> findActiveByLowerNameIn(@Param("lowerNames") Collection<String> lowerNames);

    long countByIsActiveTrue();

    java.util.Optional<Medicine> findByBarcode(String barcode);

    boolean existsByBarcodeAndIdNot(String barcode, String id);

    /**
     * Lightweight quick-search for the billing combobox — active medicines only
     * (you can't sell a discontinued item), no pagination metadata, capped by the
     * caller-supplied {@link Pageable} size. Deliberately does NOT match on
     * barcode — the frontend resolves barcodes via the separate exact-match
     * {@code findByBarcode} lookup instead (see MedicineSearchCombobox.tsx).
     */
    @Query("""
            SELECT m FROM Medicine m
            WHERE m.isActive = true
              AND (LOWER(m.name) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                   OR LOWER(m.genericName) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%'))
                   OR LOWER(m.manufacturer) LIKE LOWER(CONCAT('%', CAST(:q AS string), '%')))
            ORDER BY m.name ASC
            """)
    List<Medicine> quickSearch(@Param("q") String q, Pageable pageable);

    /**
     * Generic-substitution candidates: other active medicines sharing the source's
     * genericName, optionally narrowed to the same strength/form. strength/form are
     * cast explicitly for the same null-parameter-type-inference reason as the search
     * methods above (see InventoryRepository.search javadoc).
     */
    @Query("""
            SELECT m FROM Medicine m
            WHERE m.isActive = true AND m.id <> :excludeId
              AND LOWER(m.genericName) = LOWER(CAST(:genericName AS string))
              AND (:strength IS NULL OR LOWER(m.strength) = LOWER(CAST(:strength AS string)))
              AND (:form IS NULL OR LOWER(m.form) = LOWER(CAST(:form AS string)))
            ORDER BY m.name ASC
            """)
    List<Medicine> findAlternatives(@Param("genericName") String genericName,
                                    @Param("strength") String strength,
                                    @Param("form") String form,
                                    @Param("excludeId") String excludeId);
}
