package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.ImportJobStatus;
import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.migration.dto.CommitResult;
import com.checkup.pharmacy.modules.migration.dto.CreateSessionRequest;
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
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which side of the size threshold a commit falls on, and what the caller gets back.
 *
 * <p>Scope note: these cover the DISPATCH decision and the job row the wizard polls.
 * They do not execute the background worker — the dispatch is registered as an
 * after-commit callback, and a {@code @Transactional} test rolls back rather than
 * commits, so nothing fires. That is deliberate isolation, not an oversight: it keeps
 * these tests from leaving threads running against a rolled-back fixture.
 */
@Transactional
class MigrationAsyncDispatchIT extends AbstractPostgresIT {

    @Autowired private MigrationService migrationService;
    @Autowired private MigrationImportJobRepository jobRepository;
    @Autowired private MedicineMappingRepository mappingRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private static final Map<String, String> IDENTITY = Map.of(
            "medicineName", "medicineName", "batchNumber", "batchNumber", "expiryDate", "expiryDate",
            "quantity", "quantity", "mrp", "mrp", "purchaseRate", "purchaseRate");

    private String pharmacyId;
    private String userId;
    private String medicineId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));
        pharmacyId = pharmacy.getId();
        userId = user.getId();
        medicineId = medicine.getId();
        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    @Test
    @DisplayName("a small file still runs inline and returns its result")
    void smallFileStaysSynchronous() {
        String sessionId = sessionWithMapping();

        CommitResult result = migrationService.commitInventory(sessionId, inventoryCsv(3), IDENTITY);
        flushAndClear();

        assertThat(result.async()).isFalse();
        assertThat(result.successRows()).isEqualTo(3);
        // The common case must not have grown a polling round trip.
        assertThat(result.jobId()).isNull();
    }

    @Test
    @DisplayName("a large file is handed to the background with a job to poll")
    void largeFileIsDispatched() {
        String sessionId = sessionWithMapping();

        CommitResult result = migrationService.commitInventory(sessionId, inventoryCsv(600), IDENTITY);
        flushAndClear();

        assertThat(result.async()).isTrue();
        assertThat(result.jobId()).isNotBlank();

        // The wizard polls exactly this id, so it has to exist and be unfinished.
        MigrationImportJob job = jobRepository.findById(result.jobId()).orElseThrow();
        assertThat(job.getStatus()).isEqualTo(ImportJobStatus.PROCESSING);
        assertThat(job.getEntityType()).isEqualTo(MigrationEntityType.INVENTORY);
        assertThat(job.getSessionId()).isEqualTo(sessionId);
    }

    @Test
    @DisplayName("the same import cannot be started twice while it is running")
    void doubleDispatchIsRefused() {
        String sessionId = sessionWithMapping();
        migrationService.commitInventory(sessionId, inventoryCsv(600), IDENTITY);
        flushAndClear();

        // A double-click would otherwise start a second worker over the same file and
        // discover row by row that every line is a duplicate.
        org.assertj.core.api.Assertions
                .assertThatThrownBy(() -> migrationService.commitInventory(sessionId, inventoryCsv(600), IDENTITY))
                .isInstanceOf(com.checkup.pharmacy.common.exception.ConflictException.class)
                .hasMessageContaining("already running");
    }

    @Test
    @DisplayName("a finished import settles the SAME row the caller was told to poll")
    void syncCommitCompletesTheDispatchedJob() {
        // What the background worker does when it runs: the commit must complete the
        // existing PROCESSING row rather than write a second one, or the wizard polls
        // an id that never finishes.
        String sessionId = sessionWithMapping();
        CommitResult dispatched = migrationService.commitInventory(sessionId, inventoryCsv(600), IDENTITY);
        flushAndClear();

        migrationService.commitInventorySync(sessionId, inventoryCsv(600), IDENTITY);
        flushAndClear();

        MigrationImportJob job = jobRepository.findById(dispatched.jobId()).orElseThrow();
        assertThat(job.getStatus()).isEqualTo(ImportJobStatus.COMPLETED);
        assertThat(jobRepository.findBySessionIdOrderByCreatedAtAsc(sessionId))
                .as("exactly one job row for this import, not a placeholder plus a result")
                .hasSize(1);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String sessionWithMapping() {
        String sessionId = migrationService.createSession(new CreateSessionRequest("tally", null)).id();
        MedicineMapping mapping = MedicineMapping.create(pharmacyId, "amoxicillin 250");
        mapping.confirm(medicineId, false, userId);
        mappingRepository.save(mapping);
        flushAndClear();
        return sessionId;
    }

    private static String inventoryCsv(int rows) {
        String expiry = Instant.now().plus(365, ChronoUnit.DAYS)
                .atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_LOCAL_DATE);
        StringBuilder sb = new StringBuilder("medicineName,batchNumber,expiryDate,quantity,mrp,purchaseRate\n");
        for (int i = 1; i <= rows; i++) {
            sb.append("Amoxicillin 250,BATCH-").append(i).append(',').append(expiry).append(",10,20,10\n");
        }
        return sb.toString();
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
