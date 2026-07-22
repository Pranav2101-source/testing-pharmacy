package com.checkup.pharmacy.modules.customer;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface CustomerRepository extends JpaRepository<Customer, String> {

    /**
     * customerType is compared as text (CAST ... AS string), not the enum type
     * directly: binding a null value typed as the Postgres custom enum fails with
     * "could not determine data type of parameter" (SQLState 42P18) — Postgres
     * can't resolve the enum's OID from a bare null. Casting both sides to text
     * sidesteps the issue entirely, the same way the null String search param
     * already works safely.
     *
     * search is also explicitly cast to string: a null :search bound into four
     * OR'd LOWER(CONCAT('%', :search, '%')) branches leaves Postgres unable to
     * infer the parameter's type ("function lower(bytea) does not exist") — see
     * InventoryRepository.search's javadoc for the full explanation. The CAST
     * forces text unconditionally regardless of how many branches reference it.
     */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.pharmacyId = :pharmacyId
              AND c.deletedAt IS NULL
              AND (:search IS NULL
                   OR LOWER(c.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(c.phone) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(c.abhaNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(c.cardNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
              AND (:customerType IS NULL OR CAST(c.customerType AS string) = :customerType)
            """)
    Page<Customer> search(@Param("pharmacyId") String pharmacyId,
                          @Param("search") String search,
                          @Param("customerType") String customerType,
                          Pageable pageable);

    Optional<Customer> findByIdAndPharmacyIdAndDeletedAtIsNull(String id, String pharmacyId);

    /** Total patient rows for a tenant — matches Prisma's unfiltered _count.customers. */
    long countByPharmacyId(String pharmacyId);

    /** Batched (pharmacyId, count) for a set of tenants — avoids an N+1 in platform views. */
    @Query("SELECT c.pharmacyId, COUNT(c) FROM Customer c WHERE c.pharmacyId IN :ids GROUP BY c.pharmacyId")
    java.util.List<Object[]> countByPharmacyIdIn(@Param("ids") java.util.Collection<String> ids);

    boolean existsByPharmacyIdAndCardNumberAndDeletedAtIsNull(String pharmacyId, String cardNumber);

    boolean existsByPharmacyIdAndCardNumberAndDeletedAtIsNullAndIdNot(String pharmacyId, String cardNumber, String id);

    /** Migration-import dedup: an existing customer matches on EITHER phone or name. */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL
              AND ((:phone IS NOT NULL AND c.phone = :phone) OR LOWER(c.name) = LOWER(:name))
            """)
    java.util.List<Customer> findMatchingForImport(@Param("pharmacyId") String pharmacyId,
                                                   @Param("name") String name, @Param("phone") String phone);

    /** Receivables: active customers who currently owe money (creditUsed &gt; 0), most-owing first. */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL AND c.creditUsed > 0
            ORDER BY c.creditUsed DESC
            """)
    java.util.List<Customer> findOutstanding(@Param("pharmacyId") String pharmacyId);
}
