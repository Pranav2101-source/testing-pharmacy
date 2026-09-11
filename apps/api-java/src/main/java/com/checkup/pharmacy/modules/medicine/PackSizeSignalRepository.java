package com.checkup.pharmacy.modules.medicine;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface PackSizeSignalRepository extends JpaRepository<PackSizeSignal, String> {

    /**
     * Medicines whose open signals could conceivably form a quorum — enough votes, from enough
     * shops. Deliberately the CHEAP half of the test: the agreement check needs the individual
     * implied sizes and is done in Java, but there is no reason to drag every medicine's signals
     * into memory to discover that most of them have one vote apiece.
     *
     * <p>Cross-tenant by construction — counting agreement BETWEEN pharmacies is the entire
     * mechanism — so every caller must be {@code @CrossTenant}. Row-level security would
     * otherwise fail this closed and return nothing, silently, forever.
     *
     * <p>Not a tenant-scoped finder and not meant to be; see {@code UnscopedFinderCallGuardTest}
     * for why that normally matters and why a platform-level sweep is the exception.
     */
    @Query("""
            SELECT s.medicineId FROM PackSizeSignal s
            WHERE s.resolvedAt IS NULL
            GROUP BY s.medicineId
            HAVING COUNT(s) >= :minSignals AND COUNT(DISTINCT s.pharmacyId) >= :minPharmacies
            """)
    List<String> findMedicineIdsWithPotentialQuorum(@Param("minSignals") long minSignals,
                                                    @Param("minPharmacies") long minPharmacies);

    /** Every uncounted signal for the given medicines. Cross-tenant, same as above. */
    List<PackSizeSignal> findByMedicineIdInAndResolvedAtIsNull(Collection<String> medicineIds);

    /**
     * This pharmacy's still-open signals against the given prescription lines. Read when a later
     * sale continues a line, which proves the earlier short count was a split fill rather than a
     * disagreement about the pack — see {@code BillingService#withdrawSplitFillSignals}.
     */
    List<PackSizeSignal> findByPharmacyIdAndPrescriptionItemIdInAndResolvedAtIsNull(
            String pharmacyId, Collection<String> prescriptionItemIds);

    /** This pharmacy's own signals for one medicine — the tenant-scoped read, for a per-shop view. */
    List<PackSizeSignal> findByPharmacyIdAndMedicineIdOrderByCreatedAtDesc(String pharmacyId, String medicineId);
}
