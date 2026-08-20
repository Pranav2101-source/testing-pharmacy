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

    /** Exact, batched candidates for EMR catalogue matching; fuzzy matches are deliberately excluded. */
    @Query("SELECT m FROM Medicine m WHERE m.isActive = true AND "
            + "(LOWER(m.name) IN :lowerNames OR LOWER(m.genericName) IN :lowerGenericNames)")
    List<Medicine> findActiveForEmrMatch(@Param("lowerNames") Collection<String> lowerNames,
                                         @Param("lowerGenericNames") Collection<String> lowerGenericNames);

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

    /**
     * Up to {@code perTerm} near-name candidates for each of several search terms at once,
     * in a single round trip — the batched counterpart to typing one name into
     * {@link #quickSearch}.
     *
     * <p>Exists for prescription lines a clinic sent that did not match anything exactly
     * (see {@code EmrIntegrationService}'s EXACT_NAME/GENERIC_STRENGTH_FORM strategies).
     * Those lines are shown a pharmacist to link by hand regardless — nothing here
     * auto-assigns a medicine — but a page can carry a dozen of them, and a naive "one
     * trigram query per unmatched line" turns a list page into exactly the N+1 this
     * module's own list() already had to fix once for doctor/items/upload lookups. A
     * single {@code LATERAL} join over {@code unnest(:terms)} answers all of them together.
     *
     * <p>{@code term} echoes back the exact input string so the caller can regroup rows by
     * which line they belong to without a second normalisation pass. Matched purely on
     * {@code similarity()}, no length or prefix bias — a short generic name is not
     * penalised against a long brand name here the way a LIKE prefix match would.
     *
     * <p>The 0.35 similarity floor is deliberate, not the pg_trgm session default (0.3,
     * itself mutable per-connection and therefore not something to depend on for
     * consistent results). This is a SUGGESTION shown to a pharmacist for a clinical
     * product — the cost of a suggestion too weak to be useful is a moment's confusion;
     * the cost of the floor being loose enough to make a wrong-drug guess look plausible
     * is a dispensing error. Tighten before loosening if the tradeoff ever needs revisiting.
     */
    @Query(value = """
            SELECT req.term AS term, x.id AS id, x.name AS name, x."genericName" AS genericName,
                   x.strength AS strength, x.form AS form, x.sim AS similarity
            FROM unnest(CAST(:terms AS text[])) AS req(term)
            CROSS JOIN LATERAL (
                SELECT m.id, m.name, m."genericName", m.strength, m.form,
                       similarity(LOWER(m.name), LOWER(req.term)) AS sim
                FROM medicines m
                WHERE m."isActive" = true
                  AND LOWER(m.name) % LOWER(req.term)
                  AND similarity(LOWER(m.name), LOWER(req.term)) >= 0.35
                ORDER BY sim DESC
                LIMIT :perTerm
            ) x
            """, nativeQuery = true)
    List<SimilarNameRow> findSimilarByNames(@Param("terms") String[] terms, @Param("perTerm") int perTerm);

    interface SimilarNameRow {
        String getTerm();
        String getId();
        String getName();
        String getGenericName();
        String getStrength();
        String getForm();
        double getSimilarity();
    }
}
