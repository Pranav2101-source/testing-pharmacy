package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.enums.AuditStatus;
import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.audit.AuditLog;
import com.checkup.pharmacy.modules.audit.AuditLogRepository;
import com.checkup.pharmacy.modules.medicine.dto.CreateMedicineRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The self-healing loop, end to end against a real database: signals accumulate, a quorum is
 * recognised, the catalogue row is quarantined and a review task appears.
 *
 * <p>The interaction worth pinning here is the one no unit test can see — {@link
 * PackSizeReviewService} writes {@code packSizeConfidence = DISPUTED}, and the Phase 2 trigger
 * overwrites exactly that column with {@code UNVERIFIED} unless the transaction announces
 * itself first. Two correct pieces that silently cancel each other out; only a real Postgres
 * says which one won.
 */
@Transactional
class PackSizeReviewIT extends AbstractPostgresIT {

    @Autowired private PackSizeReviewService reviewService;
    @Autowired private PackSizeSignalRepository signalRepository;
    @Autowired private MedicineService medicineService;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private AuditLogRepository auditLogRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyA;
    private String pharmacyB;

    @BeforeEach
    void seed() {
        Pharmacy a = pharmacyRepository.save(Pharmacy.create("Shop A", "ph-" + unique()));
        Pharmacy b = pharmacyRepository.save(Pharmacy.create("Shop B", "ph-" + unique()));
        pharmacyA = a.getId();
        pharmacyB = b.getId();
        User user = userRepository.save(User.create(pharmacyA, "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(user.getId(), pharmacyA, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    /** A measured medicine carrying a plausible-looking but wrong 5 ml pack size. */
    private String melgain() {
        var created = medicineService.create(new CreateMedicineRequest(
                "Melgain Solution " + unique(), "Minoxidil", "Mfr", null, null, null, null,
                new BigDecimal("12"), "Solution", null, "Bottle", null, 5, "ML", null));
        flushAndClear();
        return created.id();
    }

    /** One pharmacist overruling the engine: 40 ml, engine wanted 8 bottles, they gave `packs`. */
    private void signal(String pharmacyId, String medicineId, int packs, int declaredPackSize) {
        signalRepository.save(PackSizeSignal.capture(pharmacyId, medicineId, null, null,
                8, packs, new BigDecimal("40"), declaredPackSize));
    }

    private Medicine reload(String medicineId) {
        flushAndClear();
        return medicineRepository.findById(medicineId).orElseThrow();
    }

    private List<AuditLog> reviewTasks(String medicineId) {
        return auditLogRepository.findAll().stream()
                .filter(a -> PackSizeReviewService.REVIEW_ACTION.equals(a.getAction()))
                .filter(a -> medicineId.equals(a.getEntityId()))
                .toList();
    }

    @Test
    @DisplayName("a quorum quarantines the catalogue row and raises one review task")
    void quorumQuarantinesAndRaisesATask() {
        String id = melgain();
        assertThat(reload(id).getPackSizeConfidence()).isEqualTo(PackSizeConfidence.UNVERIFIED);

        signal(pharmacyA, id, 1, 5);   // implies >= 40
        signal(pharmacyB, id, 1, 5);   // implies >= 40
        signal(pharmacyB, id, 1, 5);   // implies >= 40
        flushAndClear();

        int quarantined = reviewService.reviewQuorums();

        assertThat(quarantined).isEqualTo(1);
        Medicine after = reload(id);
        // The trigger must NOT have overwritten this back to UNVERIFIED.
        assertThat(after.getPackSizeConfidence()).isEqualTo(PackSizeConfidence.DISPUTED);
        // The volume is deliberately untouched — billing keeps working while a human is found.
        assertThat(after.getUnitsPerPack()).isEqualTo(5);

        List<AuditLog> tasks = reviewTasks(id);
        assertThat(tasks).hasSize(1);
        AuditLog task = tasks.get(0);
        // Platform scope: the catalogue is shared, so no single pharmacy owns the task.
        assertThat(task.getPharmacyId()).isNull();
        assertThat(task.getStatus()).isEqualTo(AuditStatus.PENDING);
        assertThat(task.getNewData()).containsEntry("distinctPharmacies", 2);
        assertThat(task.getNewData().get("action").toString()).contains("Do NOT copy");
    }

    @Test
    @DisplayName("counted signals are stamped, so the next sweep does not quarantine the same medicine again")
    void countedSignalsAreNotCountedTwice() {
        String id = melgain();
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        flushAndClear();

        assertThat(reviewService.reviewQuorums()).isEqualTo(1);
        flushAndClear();

        // A second sweep with nothing new finds no open signals at all.
        assertThat(reviewService.reviewQuorums()).isZero();
        assertThat(reviewTasks(id)).hasSize(1);
        assertThat(signalRepository.findAll().stream().filter(s -> s.getMedicineId().equals(id)))
                .allMatch(s -> s.getResolvedAt() != null);
    }

    @Test
    @DisplayName("three corrections from ONE pharmacy are a local habit, and are left open to be joined later")
    void oneePharmacyIsNotAQuorum() {
        String id = melgain();
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyA, id, 1, 5);
        flushAndClear();

        assertThat(reviewService.reviewQuorums()).isZero();
        assertThat(reload(id).getPackSizeConfidence()).isEqualTo(PackSizeConfidence.UNVERIFIED);
        // Left OPEN: a second shop joining next week is exactly how this should resolve, and
        // stamping them now would throw away the evidence that gets it there.
        assertThat(signalRepository.findAll().stream().filter(s -> s.getMedicineId().equals(id)))
                .allMatch(s -> s.getResolvedAt() == null);
    }

    @Test
    @DisplayName("signals cast against a pack size somebody has since corrected are not held against the new one")
    void staleSignalsDoNotQuarantineACorrectedMedicine() {
        String id = melgain();
        // Three good signals, all disputing the OLD 5 ml value...
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        // ...and then somebody fixes the catalogue to 60 before the sweep runs.
        Medicine m = medicineRepository.findById(id).orElseThrow();
        m.setPackaging(60, "ML");
        flushAndClear();

        assertThat(reviewService.reviewQuorums()).isZero();
        assertThat(reload(id).getPackSizeConfidence()).isNotEqualTo(PackSizeConfidence.DISPUTED);
        // Closed out, not left open: they can never count against 60, and an open vote that can
        // never count is one the sweep re-reads every night for nothing.
        assertThat(signalRepository.findAll().stream().filter(s -> s.getMedicineId().equals(id)))
                .allMatch(s -> s.getResolvedAt() != null);
    }

    @Test
    @DisplayName("one stale or off-catalogue vote does not veto a quorum formed against the current pack size")
    void anOffTargetVoteDoesNotBlockTheQuorum() {
        String id = melgain();
        // A vote cast against a different divisor — an older catalogue value, or a pharmacy
        // whose own override supplied the pack size. An earlier version required EVERY open vote
        // to match the catalogue, so this one alone held the medicine below quorum for good.
        signal(pharmacyA, id, 1, 30);
        // Three real disagreements with today's 5 ml, from two shops.
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        flushAndClear();

        assertThat(reviewService.reviewQuorums()).isEqualTo(1);
        assertThat(reload(id).getPackSizeConfidence()).isEqualTo(PackSizeConfidence.DISPUTED);
        // Every vote is closed out — the three that counted, and the off-target one.
        assertThat(signalRepository.findAll().stream().filter(s -> s.getMedicineId().equals(id)))
                .allMatch(s -> s.getResolvedAt() != null);
        assertThat(signalRepository.findAll().stream()
                .filter(s -> s.getMedicineId().equals(id) && s.getDeclaredPackSize() == 30))
                .allMatch(s -> s.getResolutionNote().contains("not evidence"));
    }

    @Test
    @DisplayName("an already-quarantined medicine is not re-raised, but its signals stop piling up")
    void alreadyDisputedMedicineIsNotReRaised() {
        String id = melgain();
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        flushAndClear();
        assertThat(reviewService.reviewQuorums()).isEqualTo(1);
        flushAndClear();

        // Three more corrections arrive while the task is still open.
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        flushAndClear();

        assertThat(reviewService.reviewQuorums()).isZero();
        // One task, not two — a duplicate would only bury the first.
        assertThat(reviewTasks(id)).hasSize(1);
        // But the new signals are closed out, so the pile does not grow behind an open task.
        assertThat(signalRepository.findAll().stream().filter(s -> s.getMedicineId().equals(id)))
                .allMatch(s -> s.getResolvedAt() != null);
    }

    /**
     * The quarantine has to outlive edits that do not address it, or it retires itself the
     * first time somebody fixes a typo in the manufacturer field — a review nobody performed.
     */
    @Test
    @DisplayName("an unrelated catalogue edit does not lift a quarantine")
    void unrelatedEditDoesNotClearTheQuarantine() {
        String id = quarantinedMelgain();

        var m = medicineRepository.findById(id).orElseThrow();
        flushAndClear();
        medicineService.update(id, new com.checkup.pharmacy.modules.medicine.dto.UpdateMedicineRequest(
                m.getName(), "Minoxidil", "A Different Manufacturer", null, null, null, null,
                new BigDecimal("12"), "Solution", null, "Bottle", null, 5, "ML", null));

        assertThat(reload(id).getPackSizeConfidence()).isEqualTo(PackSizeConfidence.DISPUTED);
    }

    @Test
    @DisplayName("correcting the disputed pack size is what lifts the quarantine")
    void correctingThePackSizeClearsTheQuarantine() {
        String id = quarantinedMelgain();

        var m = medicineRepository.findById(id).orElseThrow();
        flushAndClear();
        medicineService.update(id, new com.checkup.pharmacy.modules.medicine.dto.UpdateMedicineRequest(
                m.getName(), "Minoxidil", "Mfr", null, null, null, null,
                new BigDecimal("12"), "Solution", null, "Bottle", null, 60, "ML", null));

        Medicine after = reload(id);
        assertThat(after.getUnitsPerPack()).isEqualTo(60);
        assertThat(after.getPackSizeConfidence()).isEqualTo(PackSizeConfidence.UNVERIFIED);
    }

    @Test
    @DisplayName("so does going to look at a pack and confirming the number already on record")
    void confirmingAgainstAPhysicalPackClearsTheQuarantine() {
        String id = quarantinedMelgain();

        var m = medicineRepository.findById(id).orElseThrow();
        flushAndClear();
        medicineService.update(id, new com.checkup.pharmacy.modules.medicine.dto.UpdateMedicineRequest(
                m.getName(), "Minoxidil", "Mfr", null, null, null, null,
                new BigDecimal("12"), "Solution", null, "Bottle", null, 5, "ML", true));

        assertThat(reload(id).getPackSizeConfidence()).isEqualTo(PackSizeConfidence.VERIFIED);
    }

    /** A medicine already through the full quorum → quarantine lifecycle. */
    private String quarantinedMelgain() {
        String id = melgain();
        signal(pharmacyA, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        signal(pharmacyB, id, 1, 5);
        flushAndClear();
        assertThat(reviewService.reviewQuorums()).isEqualTo(1);
        flushAndClear();
        assertThat(reload(id).getPackSizeConfidence()).isEqualTo(PackSizeConfidence.DISPUTED);
        return id;
    }

    @Test
    @DisplayName("corrections that agree with the pack size on record are arithmetic, not a dispute")
    void agreementWithTheCatalogueDoesNotQuarantine() {
        // A correct 60 ml bottle. Pharmacists round a 40 ml course to one bottle, which is
        // what the engine said anyway for anything but the pack count — implied 40 sits
        // inside the tolerance band around 60, so this is not disagreement with the catalogue.
        var created = medicineService.create(new CreateMedicineRequest(
                "Correct Syrup " + unique(), "Dextro", "Mfr", null, null, null, null,
                new BigDecimal("12"), "Syrup", null, "Bottle", null, 60, "ML", null));
        flushAndClear();
        String id = created.id();

        signalRepository.save(PackSizeSignal.capture(pharmacyA, id, null, null, 2, 1, new BigDecimal("40"), 60));
        signalRepository.save(PackSizeSignal.capture(pharmacyB, id, null, null, 2, 1, new BigDecimal("45"), 60));
        signalRepository.save(PackSizeSignal.capture(pharmacyB, id, null, null, 2, 1, new BigDecimal("50"), 60));
        flushAndClear();

        assertThat(reviewService.reviewQuorums()).isZero();
        assertThat(reload(id).getPackSizeConfidence()).isNotEqualTo(PackSizeConfidence.DISPUTED);
    }
}
