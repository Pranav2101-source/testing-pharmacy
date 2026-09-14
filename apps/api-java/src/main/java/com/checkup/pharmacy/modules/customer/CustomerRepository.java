package com.checkup.pharmacy.modules.customer;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface CustomerRepository extends JpaRepository<Customer, String> {

    /**
     * Loads a customer for a credit-balance change, holding a write lock on the row.
     *
     * <p>{@code creditUsed} is adjusted as a read-modify-write in Java, and there is no
     * {@code @Version} on this entity, so two tills selling on credit to the same
     * customer could both read the old balance, both pass the limit check, and the
     * second write would overwrite the first. The customer ends up under-billed and
     * over their limit, with nothing to show it happened. Sales of DIFFERENT medicines
     * do not share a batch lock, so nothing else serialised them.
     *
     * <p>Only for paths that will actually mutate the balance — an ordinary sale must
     * not queue behind a lock it never needs.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM Customer c WHERE c.id = :id AND c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL")
    Optional<Customer> lockByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

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

    /**
     * Batched counterpart of {@link #findMatchingForImport} — see the supplier repository's
     * note: the migration commit was issuing one SELECT per CSV row.
     */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL
              AND (LOWER(c.name) IN :lowerNames OR (c.phone IS NOT NULL AND c.phone IN :phones))
            """)
    java.util.List<Customer> findMatchingForImportBatch(@Param("pharmacyId") String pharmacyId,
                                                        @Param("lowerNames") java.util.Collection<String> lowerNames,
                                                        @Param("phones") java.util.Collection<String> phones);

    /** Migration-import dedup: an existing customer matches on EITHER phone or name. */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL
              AND ((:phone IS NOT NULL AND c.phone = :phone) OR LOWER(c.name) = LOWER(:name))
            """)
    java.util.List<Customer> findMatchingForImport(@Param("pharmacyId") String pharmacyId,
                                                   @Param("name") String name, @Param("phone") String phone);

    /**
     * Receivables: active customers with a live account balance either way — money they
     * owe us, or money we hold for them. Most-owing first.
     *
     * <p>The advance side was added with deposits. Filtering on {@code creditUsed > 0}
     * alone left a customer who had paid Rs.2000 up front and owed nothing on no screen
     * at all: not here, because they owe nothing, and findable on the customer list only
     * by knowing to look. A deposit is a liability the pharmacy is carrying, so "who do
     * we settle with" has to mean both directions.
     */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL
              AND (c.creditUsed > 0 OR c.advanceBalance > 0)
            ORDER BY c.creditUsed DESC, c.advanceBalance DESC
            """)
    java.util.List<Customer> findOutstanding(@Param("pharmacyId") String pharmacyId);

    /**
     * Names and phone numbers for a batch of ids — display enrichment for reports that group
     * invoices by customer.
     *
     * <p>Takes pharmacyId even though the ids are already tenant-derived. A bare
     * {@code findAllById} is one refactor away from being handed ids from somewhere else, and
     * the tenant guard exists so that possibility never has to be reasoned about per call site.
     *
     * <p>Soft-deleted customers are INCLUDED. They still have bills in the history, and a
     * report that silently rendered their rows as "Unknown" would look like missing data
     * rather than a removed record.
     */
    @Query("SELECT c FROM Customer c WHERE c.pharmacyId = :pharmacyId AND c.id IN :ids")
    java.util.List<Customer> findByIdInAndPharmacyId(@Param("ids") java.util.Collection<String> ids,
                                                     @Param("pharmacyId") String pharmacyId);
}
