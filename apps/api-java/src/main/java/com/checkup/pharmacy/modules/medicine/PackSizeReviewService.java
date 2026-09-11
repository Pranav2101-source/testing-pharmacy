package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.AuditModule;
import com.checkup.pharmacy.common.enums.AuditSeverity;
import com.checkup.pharmacy.common.enums.AuditStatus;
import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import com.checkup.pharmacy.common.util.PackSizeQuorum;
import com.checkup.pharmacy.modules.audit.AuditLog;
import com.checkup.pharmacy.modules.audit.AuditLogRepository;
import com.checkup.pharmacy.tenant.CrossTenant;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Turns a quorum of counter-level disagreements into a quarantined catalogue row and a task
 * for a human.
 *
 * <h2>What closes the loop</h2>
 * Phase 1 could tell that eight bottles for a 40&nbsp;ml course was implausible. Phase 2 could
 * tell that nobody had ever checked the divisor. Neither could tell what the bottle actually
 * holds, because neither has ever seen one. Pharmacists have. Every time one of them overrules
 * the engine at the till, the system learns something it cannot derive — and until now it threw
 * that away. This is where it is spent.
 *
 * <h2>What it deliberately does not do</h2>
 * It does not write a corrected volume. Not because the arithmetic is hard, but because it
 * would be wrong: an implied pack size is a lower bound recovered from what happened to be
 * dispensed, and the Melgain case makes the point exactly — pharmacists handing one bottle
 * against 40&nbsp;ml imply "at least 40" for a bottle that really holds 60. Writing 40 would
 * replace a badly wrong number with a subtly wrong one, and subtly wrong is worse: nothing
 * downstream would ever look implausible again, and the guard rails built in Phase 1 would go
 * quiet on a value that is still incorrect.
 *
 * <p>So the outcome is {@link PackSizeConfidence#DISPUTED} — the quarantine state built in
 * Phase 2 — plus a review task. A human with a pack in their hand is still the only thing that
 * can produce a number, and this makes that person's queue, not their decision.
 */
@Service
public class PackSizeReviewService {

    private static final Logger log = LoggerFactory.getLogger(PackSizeReviewService.class);

    /**
     * Emitted as a platform-scope {@link AuditLog} row — {@code pharmacyId} null, which under
     * row-level security is visible only through the bypass a PLATFORM_ADMIN carries. The
     * catalogue is a platform-owned table, so its review queue belongs to the same audience.
     */
    public static final String REVIEW_ACTION = "PACK_SIZE_QUORUM_QUARANTINE";

    private final PackSizeSignalRepository signalRepository;
    private final MedicineRepository medicineRepository;
    private final AuditLogRepository auditLogRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public PackSizeReviewService(PackSizeSignalRepository signalRepository,
                                 MedicineRepository medicineRepository,
                                 AuditLogRepository auditLogRepository) {
        this.signalRepository = signalRepository;
        this.medicineRepository = medicineRepository;
        this.auditLogRepository = auditLogRepository;
    }

    /**
     * One sweep. Returns how many medicines were quarantined.
     *
     * <p>Cross-tenant because agreement BETWEEN pharmacies is the mechanism — a tenant-scoped
     * read would see one shop's signals and could never reach a quorum by construction. The
     * elevation is narrow: this method reads signals and writes the platform-owned catalogue,
     * and touches no tenant-owned row except to stamp the signals it has counted.
     *
     * <p>One transaction for the sweep rather than one per medicine, unlike {@code
     * TenantSweeper}: the work is bounded by how many medicines reached a quorum, which is a
     * handful at most, and quarantining a row while failing to mark its signals counted would
     * re-quarantine it every night.
     */
    @CrossTenant("Pack-size quorum — counts agreement ACROSS pharmacies, which is the mechanism itself.")
    @Transactional
    public int reviewQuorums() {
        // FIRST, before anything is dirty: the catalogue writes below set packSizeConfidence,
        // and a BEFORE trigger overwrites that with UNVERIFIED / RAW_WRITE unless this
        // transaction announces itself. A native query auto-flushes, so calling it later would
        // push a medicine UPDATE out ahead of the set_config meant to cover it — the same
        // ordering constraint MedicineService.announcePackSizeEvidence documents.
        announcePackSizeEvidence();

        List<String> candidateIds = signalRepository.findMedicineIdsWithPotentialQuorum(
                PackSizeQuorum.MIN_SIGNALS, PackSizeQuorum.MIN_PHARMACIES);
        if (candidateIds.isEmpty()) {
            return 0;
        }

        List<PackSizeSignal> open = signalRepository.findByMedicineIdInAndResolvedAtIsNull(candidateIds);
        Map<String, List<PackSizeSignal>> byMedicine = new LinkedHashMap<>();
        for (PackSizeSignal s : open) {
            byMedicine.computeIfAbsent(s.getMedicineId(), k -> new ArrayList<>()).add(s);
        }

        Map<String, Medicine> medicines = new HashMap<>();
        for (Medicine m : medicineRepository.findAllById(byMedicine.keySet())) {
            medicines.put(m.getId(), m);
        }

        Instant now = Instant.now();
        int quarantined = 0;
        for (Map.Entry<String, List<PackSizeSignal>> entry : byMedicine.entrySet()) {
            Medicine medicine = medicines.get(entry.getKey());
            if (medicine == null) {
                continue;
            }
            List<PackSizeSignal> signals = entry.getValue();

            // Already quarantined: the review task is open and a second identical one would
            // only bury the first. Signals are still marked counted, so the pile does not grow
            // unboundedly behind a task nobody has got to yet.
            if (medicine.getPackSizeConfidence() == PackSizeConfidence.DISPUTED) {
                resolveAll(signals, "Medicine was already under review", now);
                continue;
            }

            // Only votes cast against the catalogue's CURRENT number count. A vote recorded
            // against any other divisor — a value somebody has since corrected, or a pharmacy's
            // own override, which the catalogue never used — says nothing about this one.
            //
            // Those are closed out rather than left to veto the rest. An earlier version required
            // EVERY open signal to match, so a single stale vote (or one shop with its own
            // override) held the whole medicine below quorum for good: it was never counted, so
            // it was never resolved, so it was there again the next night.
            int declared = currentPackSize(medicine);
            if (declared <= 0) {
                continue;
            }
            List<PackSizeSignal> offTarget = signals.stream()
                    .filter(s -> s.getDeclaredPackSize() != declared)
                    .toList();
            resolveAll(offTarget, "Cast against a pack size other than the catalogue's current "
                    + declared + " — not evidence about it", now);
            signals = signals.stream().filter(s -> s.getDeclaredPackSize() == declared).toList();

            List<PackSizeQuorum.Observation> observations = signals.stream()
                    .map(s -> new PackSizeQuorum.Observation(s.getPharmacyId(), s.getImpliedPackSize()))
                    .toList();
            PackSizeQuorum.Verdict verdict = PackSizeQuorum.evaluate(observations, declared);

            if (!verdict.reached()) {
                // Left OPEN on purpose. A medicine three votes short of agreement today may
                // reach it next week, and stamping these would throw away the evidence that
                // gets it there. The candidate query is cheap enough to re-ask.
                continue;
            }

            medicine.quarantinePackSize();
            auditLogRepository.save(reviewTask(medicine, declared, verdict));
            resolveAll(signals, "Counted toward quarantine: " + verdict.summary(), now);
            quarantined++;

            log.warn("Pack size quarantined for medicine {} ({}): {}",
                    medicine.getId(), medicine.getName(), verdict.summary());
        }
        return quarantined;
    }

    /**
     * The catalogue's pack size today, or 0 when it has none.
     *
     * <p>Each signal carries the divisor it was cast against, and only those matching this
     * number are counted — otherwise a corrected medicine could be quarantined on votes cast
     * against the value it used to have, the loop punishing somebody for having already fixed
     * the thing.
     */
    private static int currentPackSize(Medicine medicine) {
        Integer current = medicine.getUnitsPerPack();
        return current == null || current <= 0 ? 0 : current;
    }

    private static void resolveAll(List<PackSizeSignal> signals, String note, Instant when) {
        for (PackSizeSignal s : signals) {
            s.resolve(note, when);
        }
    }

    /**
     * The review task itself.
     *
     * <p>A platform-scope audit row rather than a bespoke task table: the catalogue's reviewers
     * are platform admins, who already have an audit console, and every fact a reviewer needs is
     * a field on it. Inventing a second queue with no UI behind it would be a worse answer than
     * the one that is already staffed.
     *
     * <p>{@code oldData} carries what the catalogue says and {@code newData} what the counter
     * says, so the two are readable side by side. Note that {@code newData} is evidence and NOT
     * a proposed write — {@code impliedPackSize} is a lower bound, and the row says so.
     */
    private static AuditLog reviewTask(Medicine medicine, int declared, PackSizeQuorum.Verdict verdict) {
        Map<String, Object> oldData = new LinkedHashMap<>();
        oldData.put("unitsPerPack", declared);
        oldData.put("baseUnit", medicine.getBaseUnit());
        oldData.put("packSize", medicine.getPackSize());
        oldData.put("packSizeConfidence",
                medicine.getPackSizeConfidence() == null ? null : medicine.getPackSizeConfidence().name());

        Map<String, Object> newData = new LinkedHashMap<>();
        newData.put("packSizeConfidence", PackSizeConfidence.DISPUTED.name());
        newData.put("impliedPackSizeLowerBound", verdict.impliedPackSize());
        newData.put("agreeingSignals", verdict.signalCount());
        newData.put("distinctPharmacies", verdict.pharmacyCount());
        newData.put("summary", verdict.summary());
        newData.put("action", "Check a physical pack and set the real volume. Do NOT copy "
                + "impliedPackSizeLowerBound into unitsPerPack — it is the smallest pack consistent "
                + "with what was dispensed, not a measurement.");

        return AuditLog.create(
                // Platform scope: the catalogue is shared, and no single pharmacy owns this.
                null, null, null,
                AuditModule.INVENTORY, REVIEW_ACTION, "Medicine", medicine.getId(), medicine.getName(),
                oldData, newData, null, null,
                AuditSeverity.WARNING,
                // PENDING, not SUCCESS: this is a task awaiting a human, and the audit console's
                // own status filter is what makes it findable as one.
                AuditStatus.PENDING, null);
    }

    /** See {@code MedicineService.announcePackSizeEvidence} — same GUC, same ordering rule. */
    private void announcePackSizeEvidence() {
        if (entityManager == null) {
            return;
        }
        entityManager.createNativeQuery("SELECT set_config('app.pack_size_evidence', 'on', true)")
                .getSingleResult();
    }
}
