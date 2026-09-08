package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PharmacyMedicineRepository extends JpaRepository<PharmacyMedicine, String> {

    Optional<PharmacyMedicine> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * The tenant-scoped counterpart to {@code findAllById} — that overload carries no
     * pharmacyId predicate, so a batch id lookup on this tenant-owned entity must go
     * through this instead (see UnscopedFinderCallGuardTest). Used wherever a caller
     * already has a batch of ids known to belong to one pharmacy (a GRN's own local
     * medicines) and wants the query itself, not a post-fetch filter, to be the thing
     * that enforces that.
     */
    List<PharmacyMedicine> findByIdInAndPharmacyId(Collection<String> ids, String pharmacyId);

    /** Repeat-GRN lookup: does this pharmacy already have a local identity for this name? Exact match only — same reasoning as MedicineRepository's dedup check: a loose match here would silently fold two different local products into one. */
    Optional<PharmacyMedicine> findFirstByPharmacyIdAndNameIgnoreCase(String pharmacyId, String name);

    /** Backs the "pending local medicines" review list — fuzzy candidates a pharmacist hasn't confirmed yet. */
    List<PharmacyMedicine> findByPharmacyIdAndMatchStatusOrderByCreatedAtDesc(String pharmacyId, MedicineMatchStatus matchStatus);

    /** Scheduled backstop sweep: anything the async matcher missed (crash, pool saturation). */
    List<PharmacyMedicine> findByPharmacyIdAndMatchStatusAndCreatedAtBefore(
            String pharmacyId, MedicineMatchStatus matchStatus, Instant cutoff);

    /** Every local medicine this pharmacy has, any status — backs the full directory view (not just pending review). */
    List<PharmacyMedicine> findByPharmacyIdOrderByCreatedAtDesc(String pharmacyId);

    /**
     * Billing search's {@code includeLocal} merge — excludes {@code LINKED} rows, which already
     * have a usable global identity, so surfacing both would just be the same product twice.
     */
    List<PharmacyMedicine> findByPharmacyIdAndNameContainingIgnoreCaseAndMatchStatusNot(
            String pharmacyId, String name, MedicineMatchStatus excludedStatus, Pageable pageable);
}
