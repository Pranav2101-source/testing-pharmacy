package com.checkup.pharmacy.modules.migration;

import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.ImportJobStatus;
import com.checkup.pharmacy.common.enums.MigrationEntityType;
import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.doctor.Doctor;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovement;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.migration.csv.ColumnMapper;
import com.checkup.pharmacy.modules.migration.csv.MigrationCsvParser;
import com.checkup.pharmacy.modules.migration.csv.MigrationRowValidator;
import com.checkup.pharmacy.modules.migration.csv.ParsedCsv;
import com.checkup.pharmacy.modules.migration.csv.ValidatedCustomerRow;
import com.checkup.pharmacy.modules.migration.csv.ValidatedDoctorRow;
import com.checkup.pharmacy.modules.migration.csv.ValidatedInventoryRow;
import com.checkup.pharmacy.modules.migration.csv.ValidatedSupplierRow;
import com.checkup.pharmacy.modules.migration.dto.CommitResult;
import com.checkup.pharmacy.modules.migration.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.migration.dto.HistoryItemResponse;
import com.checkup.pharmacy.modules.migration.dto.ImportJobResponse;
import com.checkup.pharmacy.modules.migration.dto.MedicineMappingResponse;
import com.checkup.pharmacy.modules.migration.dto.MedicineMappingsRequest;
import com.checkup.pharmacy.modules.migration.dto.MedicineSuggestionResponse;
import com.checkup.pharmacy.modules.migration.dto.PreviewResult;
import com.checkup.pharmacy.modules.migration.dto.RowIssue;
import com.checkup.pharmacy.modules.migration.dto.SessionResponse;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.security.UserPrincipal;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.PageRequest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Collection;
import java.util.Map;
import java.util.Set;

/**
 * CSV-import onboarding wizard.
 *
 * <p>A commit up to {@link #ASYNC_ROW_THRESHOLD} rows runs inline and returns its
 * result immediately — the right experience for the small files that are the common
 * case. Anything larger is handed to {@link MigrationAsyncCommitter} and reported
 * through a {@link MigrationImportJob} row that the wizard polls, because a
 * 50,000-row import cannot finish inside an HTTP request before the browser or the
 * proxy in front of the API gives up on it. The 50,000-row hard cap still applies.
 *
 * <p>This restores what the Node backend did with pg-boss and the Java rebuild
 * dropped: {@code CommitResult.async} was hardcoded false and every job row was
 * written already-COMPLETED, purely so {@code GET /migration/history} had something
 * to read.
 */
@Service
public class MigrationService {

    private static final int MAX_IMPORT_ROWS = 50_000;
    private static final int MEDICINE_CANDIDATE_LIMIT = 50;
    private static final int MEDICINE_SUGGESTION_TOP_N = 3;
    /** Rows written before the persistence context is flushed and emptied — see drainIfBatchFull. */
    private static final int PERSISTENCE_BATCH_SIZE = 500;
    /**
     * Rows above which a commit is handed to a background worker. Matches the
     * threshold the Node backend used before the Java rebuild dropped the behaviour.
     */
    private static final int ASYNC_ROW_THRESHOLD = 500;

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(MigrationService.class);

    /** Reference type stamped on every movement this module creates. */
    static final String OPENING_BALANCE_REFERENCE = "OPENING_BALANCE";

    private final com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository overrideRepository;
    private final MigrationRollbackGuard rollbackGuard;
    private final MigrationAsyncCommitter asyncCommitter;
    /**
     * This bean through its own proxy. The commit bodies are @Transactional, and a
     * plain `this.commitInventorySync(...)` would be a self-invocation that never
     * reaches the proxy — the import would run with no transaction at all and every
     * row would auto-commit on its own, so a failure at row 40,000 would leave 39,999
     * rows behind instead of rolling back. ObjectProvider defers the lookup, which is
     * what keeps this from being a circular dependency at construction time.
     */
    private final ObjectProvider<MigrationService> selfProvider;
    private final jakarta.persistence.EntityManager entityManager;
    private final MigrationSessionRepository sessionRepository;
    private final MigrationImportJobRepository jobRepository;
    private final MedicineMappingRepository mappingRepository;
    private final MigrationCreatedRecordRepository createdRecordRepository;
    private final MigrationCsvParser csvParser;
    private final ColumnMapper columnMapper;
    private final MigrationRowValidator rowValidator;
    private final MedicineRepository medicineRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository inventoryMovementRepository;
    private final SupplierRepository supplierRepository;
    private final CustomerRepository customerRepository;
    private final DoctorRepository doctorRepository;

    public MigrationService(MigrationSessionRepository sessionRepository, MigrationImportJobRepository jobRepository,
                            MedicineMappingRepository mappingRepository,
                            MigrationCreatedRecordRepository createdRecordRepository, MigrationCsvParser csvParser,
                            ColumnMapper columnMapper, MigrationRowValidator rowValidator,
                            MedicineRepository medicineRepository, InventoryRepository inventoryRepository,
                            InventoryMovementRepository inventoryMovementRepository,
                            SupplierRepository supplierRepository, CustomerRepository customerRepository,
                            DoctorRepository doctorRepository,
                            com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository overrideRepository,
                            MigrationRollbackGuard rollbackGuard,
                            MigrationAsyncCommitter asyncCommitter,
                            ObjectProvider<MigrationService> selfProvider,
                            jakarta.persistence.EntityManager entityManager) {
        this.sessionRepository = sessionRepository;
        this.jobRepository = jobRepository;
        this.mappingRepository = mappingRepository;
        this.createdRecordRepository = createdRecordRepository;
        this.csvParser = csvParser;
        this.columnMapper = columnMapper;
        this.rowValidator = rowValidator;
        this.medicineRepository = medicineRepository;
        this.inventoryRepository = inventoryRepository;
        this.inventoryMovementRepository = inventoryMovementRepository;
        this.supplierRepository = supplierRepository;
        this.customerRepository = customerRepository;
        this.doctorRepository = doctorRepository;
        this.overrideRepository = overrideRepository;
        this.rollbackGuard = rollbackGuard;
        this.asyncCommitter = asyncCommitter;
        this.selfProvider = selfProvider;
        this.entityManager = entityManager;
    }

    // ── Sessions ─────────────────────────────────────────────────────────────

    @Transactional
    public SessionResponse createSession(CreateSessionRequest req) {
        var principal = TenantContext.currentUser();
        MigrationSession session = MigrationSession.create(principal.pharmacyId(), principal.userId(),
                blankToNull(req.sourceSoftware()), blankToNull(req.notes()));
        sessionRepository.save(session);
        return toResponse(session);
    }

    @Transactional(readOnly = true)
    public List<SessionResponse> listSessions() {
        return sessionRepository.findByPharmacyIdOrderByCreatedAtDesc(TenantContext.pharmacyId())
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<HistoryItemResponse> history() {
        String pharmacyId = TenantContext.pharmacyId();
        Map<MigrationEntityType, MigrationImportJob> latest = new LinkedHashMap<>();
        for (MigrationImportJob job : jobRepository.findCompletedNotRolledBack(pharmacyId)) {
            latest.putIfAbsent(job.getEntityType(), job); // already ordered newest-first
        }
        return latest.values().stream()
                .map(j -> new HistoryItemResponse(j.getEntityType().name(), j.getSuccessRows(), j.getCompletedAt()))
                .toList();
    }

    @Transactional(readOnly = true)
    public SessionResponse getSession(String id) {
        return toResponse(loadSession(id));
    }

    @Transactional
    public SessionResponse completeSession(String id) {
        MigrationSession session = loadSession(id);
        session.complete();
        return toResponse(session);
    }

    /** Deletion order INVENTORY -> MEDICINE -> SUPPLIERS -> CUSTOMERS -> DOCTORS; medicines are deactivated, not deleted. */
    @Transactional
    public SessionResponse rollbackSession(String id) {
        MigrationSession session = loadSession(id);
        if (session.getStatus() == com.checkup.pharmacy.common.enums.MigrationSessionStatus.ROLLED_BACK) {
            throw new ConflictException("Session has already been rolled back");
        }
        boolean stillRunning = jobRepository.findBySessionIdOrderByCreatedAtAsc(id).stream()
                .anyMatch(j -> j.getStatus() == ImportJobStatus.PROCESSING || j.getStatus() == ImportJobStatus.PENDING);
        if (stillRunning) {
            throw new ConflictException(
                    "An import for this session is still running in the background — wait for it to finish before rolling back.");
        }

        String pharmacyId = session.getPharmacyId();
        List<MigrationEntityType> order = List.of(MigrationEntityType.INVENTORY, MigrationEntityType.MEDICINE,
                MigrationEntityType.SUPPLIERS, MigrationEntityType.CUSTOMERS, MigrationEntityType.DOCTORS);

        Map<MigrationEntityType, List<String>> idsByEntityType = new LinkedHashMap<>();
        for (var entityType : order) {
            List<String> ids = createdRecordRepository.findBySessionIdAndEntityType(id, entityType).stream()
                    .map(MigrationCreatedRecord::getEntityId).toList();
            if (!ids.isEmpty()) {
                idsByEntityType.put(entityType, ids);
            }
        }

        // Refuse BEFORE deleting anything, and say exactly why.
        //
        // Rollback undoes an import by deleting what it created, which stops being
        // safe the moment the pharmacy starts trading on that data. Reaching the
        // delete and letting the database refuse it meant nothing was rolled back —
        // not even the parts still safe to undo — and the pharmacist was shown a
        // constraint-violation message that named neither the cause nor the remedy.
        List<MigrationRollbackGuard.Blocker> blockers = rollbackGuard.findBlockers(pharmacyId, idsByEntityType);
        if (!blockers.isEmpty()) {
            throw new ConflictException(
                    "This import can no longer be rolled back — it is already in use: "
                    + blockers.stream().map(MigrationRollbackGuard.Blocker::reason)
                            .collect(java.util.stream.Collectors.joining("; "))
                    + ". Undoing it would break those records. Correct the data directly instead, "
                    + "or cancel the individual bills and returns first.");
        }

        try {
            for (var entry : idsByEntityType.entrySet()) {
                rollbackEntity(entry.getKey(), entry.getValue(), pharmacyId);
            }
            // Surface any constraint the guard does not know about HERE, while the
            // failure can still be explained, rather than letting it escape as a
            // generic conflict from the exception handler. The flush is what forces
            // the deletes to the database inside this try.
            entityManager.flush();
        } catch (DataIntegrityViolationException | jakarta.persistence.PersistenceException e) {
            // The guard covers the cases we can name. This catches the rest — a race
            // (something referenced the data between the check and the delete) or a
            // relationship added since this guard was written.
            log.warn("Migration rollback {} refused by the database: {}", id, e.getMessage());
            throw new ConflictException(
                    "This import can no longer be rolled back — some of the imported records are now "
                    + "referenced by other data in your account. Correct the data directly instead.");
        }

        session.rollBack();
        return toResponse(session);
    }

    private void rollbackEntity(MigrationEntityType entityType, List<String> ids, String pharmacyId) {
        switch (entityType) {
            case INVENTORY -> deleteInventoryAndMovements(ids, pharmacyId);
            case MEDICINE -> deactivateUnusedMedicines(ids);
            case SUPPLIERS -> supplierRepository.deleteAll(supplierRepository.findAllById(ids).stream()
                    .filter(s -> s.getPharmacyId().equals(pharmacyId)).toList());
            case CUSTOMERS -> customerRepository.deleteAll(customerRepository.findAllById(ids).stream()
                    .filter(c -> c.getPharmacyId().equals(pharmacyId)).toList());
            case DOCTORS -> doctorRepository.deleteAll(doctorRepository.findAllById(ids).stream()
                    .filter(d -> d.getPharmacyId().equals(pharmacyId)).toList());
        }
    }

    /**
     * Deactivates catalogue entries this import created — but only the ones nobody is
     * using.
     *
     * <p>{@code Medicine} is a GLOBAL catalogue with no pharmacyId: every pharmacy on
     * the platform shares it, and medicine resolution deliberately reuses an existing
     * entry rather than creating a duplicate. So an unconditional deactivate here
     * reached across tenants. Pharmacy A imports "Amoxicillin 250" and creates the
     * entry; pharmacy B imports the same name later and is pointed at A's entry; A
     * rolls back, and B's sales start failing with "Medicine is inactive and cannot be
     * billed" — for a rollback in an account B cannot see.
     *
     * <p>Inventory is checked AFTER this session's own batches have been deleted, so a
     * batch created by this same import does not count as a user of the medicine.
     * Anything still referencing it belongs to someone else, and the entry stays live.
     */
    private void deactivateUnusedMedicines(List<String> medicineIds) {
        // Force the inventory deletes above to the database first: this asks Postgres
        // "who still references these medicines", and a pending delete sitting in the
        // persistence context would not be reflected in the answer.
        entityManager.flush();

        Set<String> stillInUse = new HashSet<>(
                inventoryRepository.findMedicineIdsInUse(medicineIds));
        stillInUse.addAll(overrideRepository.findMedicineIdsWithOverrides(medicineIds));

        for (Medicine m : medicineRepository.findAllById(medicineIds)) {
            if (stillInUse.contains(m.getId())) {
                // Left ACTIVE on purpose. Another pharmacy is stocking or pricing this
                // catalogue entry; deactivating it would break their billing.
                log.info("Migration rollback: catalogue medicine {} left active — still referenced elsewhere", m.getId());
                continue;
            }
            m.deactivate();
            medicineRepository.save(m);
        }
    }

    private void deleteInventoryAndMovements(List<String> inventoryIds, String pharmacyId) {
        // Movements this session created all carry referenceType OPENING_BALANCE — delete those first
        // (FK dependency: a movement references its inventory row).
        inventoryMovementRepository.deleteAll(
                inventoryMovementRepository.findByInventoryIdInAndReferenceType(inventoryIds, OPENING_BALANCE_REFERENCE));
        List<Inventory> batches = inventoryRepository.findAllById(inventoryIds).stream()
                .filter(i -> i.getPharmacyId().equals(pharmacyId)).toList();
        inventoryRepository.deleteAll(batches);
    }

    // ── Column mapping ───────────────────────────────────────────────────────

    public List<ColumnMapper.ColumnDetection> detectColumns(List<String> headers) {
        return columnMapper.detectColumns(headers);
    }

    @Transactional
    public SessionResponse saveColumnMappings(String id, Map<String, String> mappings) {
        MigrationSession session = loadSession(id);
        session.setColumnMappings(mappings);
        return toResponse(session);
    }

    // ── Medicine mapping ─────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<MedicineSuggestionResponse> medicineSuggestions(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();

        ParsedCsv parsed = csvParser.parse(csvText);
        guardRowCount(parsed.rows().size());

        Set<String> uniqueLower = new LinkedHashSet<>();
        Map<String, String> displayByLower = new LinkedHashMap<>();
        for (var row : parsed.rows()) {
            Map<String, String> fields = csvParser.applyColumnMapping(row, columnMappings);
            String name = fields.get("medicineName");
            if (name == null || name.isBlank()) {
                continue;
            }
            String lower = name.trim().toLowerCase(Locale.ROOT);
            uniqueLower.add(lower);
            displayByLower.putIfAbsent(lower, name.trim());
        }
        if (uniqueLower.isEmpty()) {
            return List.of();
        }

        Map<String, MedicineMapping> existing = mappingRepository.findByPharmacyIdAndCsvValueIn(pharmacyId, uniqueLower)
                .stream().collect(java.util.stream.Collectors.toMap(MedicineMapping::getCsvValue, m -> m));

        List<MedicineSuggestionResponse> results = new ArrayList<>();
        for (String lower : uniqueLower) {
            String display = displayByLower.get(lower);
            MedicineMapping mapping = existing.get(lower);
            if (mapping != null && mapping.getMedicineId() != null) {
                results.add(new MedicineSuggestionResponse(display, List.of(),
                        new MedicineSuggestionResponse.ExistingMapping(mapping.getMedicineId(), mapping.isNewMedicine())));
                continue;
            }

            List<Medicine> candidates = medicineRepository.quickSearch(display, PageRequest.of(0, MEDICINE_CANDIDATE_LIMIT));
            List<Medicine> ranked = candidates.stream()
                    .map(m -> Map.entry(m, MedicineSimilarity.score(display, m.getName())))
                    .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                    .limit(MEDICINE_SUGGESTION_TOP_N)
                    .map(e -> e.getKey())
                    .toList();

            List<MedicineSuggestionResponse.Suggestion> suggestions = new ArrayList<>();
            double[] confidenceByRank = {0.9, 0.7, 0.5};
            for (int i = 0; i < ranked.size(); i++) {
                Medicine m = ranked.get(i);
                suggestions.add(new MedicineSuggestionResponse.Suggestion(m.getId(), m.getName(), m.getManufacturer(),
                        confidenceByRank[Math.min(i, confidenceByRank.length - 1)]));
            }
            results.add(new MedicineSuggestionResponse(display, suggestions, null));
        }
        return results;
    }

    /**
     * Confirms every CSV-name -> catalog-medicine decision for a session in one pass.
     *
     * <p>This used to issue one SELECT and one INSERT per entry. A real 513-medicine import
     * therefore made over a thousand round trips and exceeded the edge proxy's gateway timeout:
     * the client saw a 504 while the transaction actually committed, so the wizard reported
     * failure on work that had succeeded — and a retry then re-did all of it. Everything below
     * is batched into two reads and one flush.
     *
     * <p>Three things the per-entry version could not see, because it only ever held one row:
     * a request that names the same csvValue twice (the second insert violated the
     * (pharmacyId, csvValue) unique constraint and surfaced as a raw 500), a medicineId that
     * does not exist (accepted here, then failed much later during commit with a message that
     * pointed at the CSV rather than the mapping), and a mapping that is neither linked to a
     * medicine nor marked as new (silently stored, then rejected at commit).
     */
    @Transactional
    public List<MedicineMappingResponse> confirmMedicineMappings(String id, MedicineMappingsRequest req) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        var principal = TenantContext.currentUser();

        guardRowCount(req.mappings().size());

        // Collapse duplicates before touching the database. The wizard sends one entry per
        // distinct name, but a hand-built request (or a double-submit) can repeat one, and
        // the unique constraint would turn that into an unreadable 500. Last entry wins, so
        // the result is deterministic rather than dependent on insert order.
        Map<String, MedicineMappingsRequest.Entry> byCsvValue = new LinkedHashMap<>();
        for (var entry : req.mappings()) {
            if (entry.csvValue() == null || entry.csvValue().isBlank()) {
                continue;
            }
            byCsvValue.put(entry.csvValue().trim().toLowerCase(Locale.ROOT), entry);
        }
        if (byCsvValue.isEmpty()) {
            throw new BadRequestException("No medicine mappings were supplied — every entry had a blank name");
        }

        // Reject bad references now, while the message can still name the medicine the user
        // picked. Left to the commit, the same problem reads as a broken CSV row instead.
        Set<String> referencedIds = byCsvValue.values().stream()
                .map(MedicineMappingsRequest.Entry::medicineId)
                .filter(m -> m != null && !m.isBlank())
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        Set<String> knownIds = referencedIds.isEmpty() ? Set.of()
                : medicineRepository.findAllById(referencedIds).stream()
                        .map(Medicine::getId)
                        .collect(java.util.stream.Collectors.toSet());

        List<String> unresolvable = new ArrayList<>();
        for (var e : byCsvValue.entrySet()) {
            String medicineId = e.getValue().medicineId();
            boolean linked = medicineId != null && !medicineId.isBlank();
            if (linked && !knownIds.contains(medicineId)) {
                unresolvable.add("\"" + e.getKey() + "\" points at a medicine that no longer exists");
            } else if (!linked && !e.getValue().isNew()) {
                unresolvable.add("\"" + e.getKey() + "\" is not linked to a medicine and is not marked as new");
            }
        }
        if (!unresolvable.isEmpty()) {
            String detail = unresolvable.stream().limit(5).collect(java.util.stream.Collectors.joining("; "));
            throw new BadRequestException(unresolvable.size() + " medicine mapping(s) could not be saved: " + detail
                    + (unresolvable.size() > 5 ? "; and " + (unresolvable.size() - 5) + " more" : "")
                    + ". Re-run the medicine-matching step and confirm these names.");
        }

        // ONE query for every mapping this request could update, instead of one per entry.
        Map<String, MedicineMapping> existing = mappingRepository
                .findByPharmacyIdAndCsvValueIn(pharmacyId, byCsvValue.keySet()).stream()
                .collect(java.util.stream.Collectors.toMap(MedicineMapping::getCsvValue, m -> m, (a, b) -> a));

        List<MedicineMapping> toSave = new ArrayList<>(byCsvValue.size());
        for (var e : byCsvValue.entrySet()) {
            MedicineMapping mapping = existing.get(e.getKey());
            if (mapping == null) {
                mapping = MedicineMapping.create(pharmacyId, e.getKey());
            }
            mapping.confirm(e.getValue().medicineId(), e.getValue().isNew(), principal.userId());
            toSave.add(mapping);
        }
        mappingRepository.saveAll(toSave);

        return toSave.stream().map(MedicineMappingResponse::from).toList();
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public PreviewResult previewInventory(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        ParsedCsv parsed = csvParser.parse(csvText);
        guardRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        List<ValidatedInventoryRow> valid = new ArrayList<>();
        for (var row : parsed.rows()) {
            Map<String, String> fields = csvParser.applyColumnMapping(row, columnMappings);
            ValidatedInventoryRow v = rowValidator.validateInventoryRow(row.rowNumber(), fields, issues);
            if (v != null) {
                valid.add(v);
            }
        }

        Set<String> uniqueLower = new LinkedHashSet<>();
        Map<String, String> displayByLower = new LinkedHashMap<>();
        for (var v : valid) {
            String lower = v.medicineName().trim().toLowerCase(Locale.ROOT);
            uniqueLower.add(lower);
            displayByLower.putIfAbsent(lower, v.medicineName().trim());
        }
        Set<String> mapped = uniqueLower.isEmpty() ? Set.of()
                : mappingRepository.findByPharmacyIdAndCsvValueIn(session.getPharmacyId(), uniqueLower).stream()
                        .map(MedicineMapping::getCsvValue).collect(java.util.stream.Collectors.toSet());
        List<String> unmappedMedicines = uniqueLower.stream().filter(l -> !mapped.contains(l))
                .map(displayByLower::get).toList();

        List<Map<String, Object>> sampleRows = valid.stream().limit(5)
                .map(v -> (Map<String, Object>) new LinkedHashMap<String, Object>(Map.of(
                        "medicineName", v.medicineName(), "batchNumber", v.batchNumber(),
                        "quantity", v.quantity(), "mrp", v.mrp())))
                .toList();

        int totalRows = parsed.rows().size();
        return new PreviewResult(totalRows, valid.size(), totalRows - valid.size(), issues, parsed.headers(),
                unmappedMedicines, sampleRows);
    }

    // ── Commit: inventory ────────────────────────────────────────────────────

    @Transactional
    public CommitResult commitInventory(String id, String csvText, Map<String, String> columnMappings) {
        return commitMaybeAsync(MigrationEntityType.INVENTORY, id, csvText,
                () -> self().commitInventorySync(id, csvText, columnMappings));
    }

    @Transactional
    CommitResult commitInventorySync(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        var principal = TenantContext.currentUser();

        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        record Row(int rowNumber, ValidatedInventoryRow data) {
        }
        List<Row> validRows = new ArrayList<>();
        for (var row : parsed.rows()) {
            Map<String, String> fields = csvParser.applyColumnMapping(row, columnMappings);
            ValidatedInventoryRow v = rowValidator.validateInventoryRow(row.rowNumber(), fields, issues);
            if (v != null) {
                validRows.add(new Row(row.rowNumber(), v));
            }
        }

        Map<String, String> medicineIdByLowerName = resolveMedicineIds(pharmacyId, validRows.stream()
                .map(r -> r.data().medicineName()).toList(), id, principal.userId(), issues, validRows);

        // Preload existing (medicineId, batchNumber) pairs for the medicines this file touches.
        List<String> medicineIds = medicineIdByLowerName.values().stream().distinct().toList();
        Set<String> existingKeys = medicineIds.isEmpty() ? Set.of()
                : inventoryRepository.findByPharmacyIdAndMedicineIdIn(pharmacyId, medicineIds).stream()
                        .map(inv -> inv.getMedicineId() + "|" + inv.getBatchNumber())
                        .collect(java.util.stream.Collectors.toSet());

        Set<String> seenInFile = new java.util.HashSet<>();
        int successCount = 0;
        int skippedCount = 0;
        int failedCount = (int) issues.stream().filter(i -> "error".equals(i.severity())).map(RowIssue::row).distinct().count();

        for (Row row : validRows) {
            String medicineId = medicineIdByLowerName.get(row.data().medicineName().trim().toLowerCase(Locale.ROOT));
            if (medicineId == null) {
                continue; // resolution failure already recorded as an issue by resolveMedicineIds
            }
            String key = medicineId + "|" + row.data().batchNumber();
            if (existingKeys.contains(key) || !seenInFile.add(key)) {
                issues.add(RowIssue.warning(row.rowNumber(), "batchNumber",
                        "Batch \"" + row.data().batchNumber() + "\" already exists for this medicine — skipped to avoid double-counting stock"));
                skippedCount++;
                continue;
            }

            Inventory inv = Inventory.create(pharmacyId, medicineId, row.data().batchNumber(), row.data().expiryDate(),
                    row.data().quantity(), row.data().purchaseRate(), row.data().mrp(),
                    row.data().minimumStock() != null ? row.data().minimumStock() : 10, 5);
            inventoryRepository.save(inv);

            InventoryMovement movement = InventoryMovement.record(pharmacyId, inv.getId(), principal.userId(),
                    MovementType.OPENING, MovementDirection.IN, row.data().quantity(), 0, row.data().quantity(),
                    OPENING_BALANCE_REFERENCE, id, "Imported via migration wizard");
            inventoryMovementRepository.save(movement);
            createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.INVENTORY, inv.getId()));
            successCount++;
            drainIfBatchFull(successCount);
        }

        int totalRows = parsed.rows().size();
        writeJob(id, pharmacyId, MigrationEntityType.INVENTORY, totalRows, totalRows, successCount, failedCount, issues);
        // Re-loaded: drainIfBatchFull above detaches everything, including the session,
        // and a status write on a detached entity is silently dropped.
        loadSession(id).markStepCompleted("commit-inventory");

        return new CommitResult(MigrationEntityType.INVENTORY, totalRows, successCount, failedCount, skippedCount,
                issues, null, false);
    }

    /**
     * Resolves each valid row's medicineName to a catalog medicineId via the session's confirmed
     * {@link MedicineMapping}s, creating a new catalog {@link Medicine} on first use of a
     * mapping marked isNew (case-insensitive existing-name lookup first, to avoid catalog dupes
     * across pharmacies sharing the same global catalog).
     */
    private Map<String, String> resolveMedicineIds(String pharmacyId, List<String> medicineNames, String sessionId,
                                                    String userId, List<RowIssue> issues, List<?> rowsForNumbering) {
        Map<String, String> resolved = new LinkedHashMap<>();
        Set<String> uniqueLower = new LinkedHashSet<>();
        for (String name : medicineNames) {
            uniqueLower.add(name.trim().toLowerCase(Locale.ROOT));
        }
        if (uniqueLower.isEmpty()) {
            return resolved;
        }

        Map<String, MedicineMapping> mappings = mappingRepository.findByPharmacyIdAndCsvValueIn(pharmacyId, uniqueLower)
                .stream().collect(java.util.stream.Collectors.toMap(MedicineMapping::getCsvValue, m -> m));

        // Pre-resolve every "new medicine" name against the catalogue in ONE query. The
        // loop below used to call findActiveByLowerNameIn(List.of(lower)) per name — a
        // batch-capable query invoked one element at a time, so a 5,000-medicine import
        // issued 5,000 round trips to answer a question one query could answer.
        Set<String> newMedicineNames = new LinkedHashSet<>();
        for (String lower : uniqueLower) {
            MedicineMapping m = mappings.get(lower);
            if (m != null && m.getMedicineId() == null && m.isNewMedicine()) {
                newMedicineNames.add(lower);
            }
        }
        Map<String, Medicine> existingByLowerName = new LinkedHashMap<>();
        if (!newMedicineNames.isEmpty()) {
            for (Medicine m : medicineRepository.findActiveByLowerNameIn(List.copyOf(newMedicineNames))) {
                // First wins — mirrors the previous findFirst() on a per-name lookup.
                existingByLowerName.putIfAbsent(m.getName().trim().toLowerCase(Locale.ROOT), m);
            }
        }

        for (String lower : uniqueLower) {
            MedicineMapping mapping = mappings.get(lower);
            if (mapping == null) {
                issues.add(RowIssue.error(0, "medicineName",
                        "\"" + lower + "\" was never mapped — go back to the medicine-mapping step"));
                continue;
            }
            String medicineId = mapping.getMedicineId();
            if (medicineId == null && mapping.isNewMedicine()) {
                String displayName = lower; // best effort; exact casing isn't preserved on the mapping row
                Medicine existing = existingByLowerName.get(lower);
                if (existing != null) {
                    medicineId = existing.getId();
                } else {
                    Medicine created = Medicine.create(capitalize(displayName), new BigDecimal("12"));
                    medicineRepository.save(created);
                    medicineId = created.getId();
                    createdRecordRepository.save(MigrationCreatedRecord.create(sessionId, MigrationEntityType.MEDICINE, medicineId));
                    // Keep the pre-loaded index current, so a medicine created earlier in
                    // this same commit is reused rather than inserted twice — the per-name
                    // query it replaced would have seen it.
                    existingByLowerName.put(lower, created);
                }
                mapping.setMedicineId(medicineId);
                mappingRepository.save(mapping);
            }
            if (medicineId == null) {
                issues.add(RowIssue.error(0, "medicineName", "\"" + lower + "\" could not be resolved to a catalog medicine"));
                continue;
            }
            resolved.put(lower, medicineId);
        }
        return resolved;
    }

    /**
     * An empty IN-list is invalid SQL, and a file can legitimately supply no gstins (or no
     * phone numbers) at all. Substitute a sentinel that cannot match a real value so the
     * query still runs and that half of the OR simply contributes nothing.
     */
    private static Collection<String> nonEmpty(Collection<String> values) {
        return values.isEmpty() ? List.of("__migration_none__") : values;
    }

    private static String capitalize(String s) {
        if (s.isBlank()) {
            return s;
        }
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    // ── Commit: suppliers / customers / doctors ─────────────────────────────

    @Transactional
    public CommitResult commitSuppliers(String id, String csvText, Map<String, String> columnMappings) {
        return commitMaybeAsync(MigrationEntityType.SUPPLIERS, id, csvText,
                () -> self().commitSuppliersSync(id, csvText, columnMappings));
    }

    @Transactional
    CommitResult commitSuppliersSync(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        Set<String> seenKeys = new java.util.HashSet<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;

        // Pass 1 — validate and de-duplicate within the file, collecting the keys the
        // whole import could match on. Nothing is written yet.
        List<ValidatedSupplierRow> toApply = new ArrayList<>();
        Set<String> lowerNames = new LinkedHashSet<>();
        Set<String> gstins = new LinkedHashSet<>();
        for (var row : parsed.rows()) {
            Map<String, String> fields = csvParser.applyColumnMapping(row, columnMappings);
            ValidatedSupplierRow v = rowValidator.validateSupplierRow(row.rowNumber(), fields, issues);
            if (v == null) {
                continue;
            }
            String dedupKey = v.gstin() != null ? v.gstin() : v.name().trim().toLowerCase(Locale.ROOT);
            if (!seenKeys.add(dedupKey)) {
                issues.add(RowIssue.warning(row.rowNumber(), "supplierName", "Duplicate supplier in file — skipped"));
                skipped++;
                continue;
            }
            toApply.add(v);
            lowerNames.add(v.name().trim().toLowerCase(Locale.ROOT));
            if (v.gstin() != null) {
                gstins.add(v.gstin());
            }
        }

        // ONE query for every existing supplier this file could match, instead of one
        // SELECT per row (50,000 rows meant 50,000 round trips).
        Map<String, Supplier> byLowerName = new LinkedHashMap<>();
        Map<String, Supplier> byGstin = new LinkedHashMap<>();
        if (!toApply.isEmpty()) {
            for (Supplier s : supplierRepository.findMatchingForImportBatch(
                    pharmacyId, nonEmpty(lowerNames), nonEmpty(gstins))) {
                byLowerName.putIfAbsent(s.getName().trim().toLowerCase(Locale.ROOT), s);
                if (s.getGstin() != null) {
                    byGstin.putIfAbsent(s.getGstin(), s);
                }
            }
        }

        // Pass 2 — apply. Same match rule as the per-row query (name OR gstin), resolved
        // in memory; gstin is checked first because it is the stronger identifier (the
        // old query returned an unordered list and took the first, so a row matching one
        // supplier by name and another by gstin picked arbitrarily).
        for (ValidatedSupplierRow v : toApply) {
            String lowerName = v.name().trim().toLowerCase(Locale.ROOT);
            Supplier match = v.gstin() != null ? byGstin.get(v.gstin()) : null;
            if (match == null) {
                match = byLowerName.get(lowerName);
            }
            List<Supplier> matches = match == null ? List.of() : List.of(match);
            if (matches.isEmpty()) {
                Supplier s = Supplier.create(pharmacyId, v.name());
                s.applyFields(v.name(), v.gstin(), v.dlNumber(), v.phone(), v.email(), v.address(), v.city(), v.state(),
                        BigDecimal.ZERO, v.creditDays() != null ? v.creditDays() : 30, null);
                if (v.openingBalance() != null) {
                    s.adjustLedgerBalance(v.openingBalance());
                }
                supplierRepository.save(s);
                createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.SUPPLIERS, s.getId()));
                // Index it so a later row that matches on the other key finds this one
                // rather than inserting a second copy — the per-row query would have seen it.
                byLowerName.putIfAbsent(lowerName, s);
                if (s.getGstin() != null) {
                    byGstin.putIfAbsent(s.getGstin(), s);
                }
                created++;
            } else {
                // Never overwrite ledgerBalance here — it tracks real GRNs, payments and
                // returns already recorded in this system, not the import. Matches
                // commitCustomers' handling of creditUsed for the identical reason.
                //
                // The previous code set it to v.openingBalance() unconditionally for a
                // matched supplier, silently clobbering a real, tracked balance with
                // whatever figure the CSV happened to carry — and because only CREATED
                // suppliers get a MigrationCreatedRecord, rolling back the session could
                // not have undone it: there was nothing recorded to roll back TO.
                // openingBalance is only meaningful for a supplier with no transaction
                // history in this system yet, i.e. the CREATED branch above.
                Supplier s = matches.get(0);
                s.applyFields(v.name(), v.gstin(), v.dlNumber(), v.phone(), v.email(), v.address(), v.city(), v.state(),
                        s.getCreditLimit(), v.creditDays() != null ? v.creditDays() : s.getCreditDays(), s.getPaymentTerms());
                supplierRepository.save(s);
                updated++;
            }
        }

        int totalRows = parsed.rows().size();
        int failedRows = (int) issues.stream().filter(i -> "error".equals(i.severity())).map(RowIssue::row).distinct().count();
        writeJob(id, pharmacyId, MigrationEntityType.SUPPLIERS, totalRows, totalRows, created + updated, failedRows, issues);
        session.markStepCompleted("suppliers");
        return new CommitResult(MigrationEntityType.SUPPLIERS, totalRows, created + updated, failedRows, skipped, issues, null, false);
    }

    @Transactional
    public CommitResult commitCustomers(String id, String csvText, Map<String, String> columnMappings) {
        return commitMaybeAsync(MigrationEntityType.CUSTOMERS, id, csvText,
                () -> self().commitCustomersSync(id, csvText, columnMappings));
    }

    @Transactional
    CommitResult commitCustomersSync(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        Set<String> seenKeys = new java.util.HashSet<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;

        // Pass 1 — validate + de-duplicate within the file (see commitSuppliers).
        List<ValidatedCustomerRow> toApply = new ArrayList<>();
        Set<String> lowerNames = new LinkedHashSet<>();
        Set<String> phones = new LinkedHashSet<>();
        for (var row : parsed.rows()) {
            Map<String, String> fields = csvParser.applyColumnMapping(row, columnMappings);
            ValidatedCustomerRow v = rowValidator.validateCustomerRow(row.rowNumber(), fields, issues);
            if (v == null) {
                continue;
            }
            String dedupKey = v.phone() != null ? v.phone() : v.name().trim().toLowerCase(Locale.ROOT);
            if (!seenKeys.add(dedupKey)) {
                issues.add(RowIssue.warning(row.rowNumber(), "customerName", "Duplicate customer in file — skipped"));
                skipped++;
                continue;
            }
            toApply.add(v);
            lowerNames.add(v.name().trim().toLowerCase(Locale.ROOT));
            if (v.phone() != null) {
                phones.add(v.phone());
            }
        }

        // ONE query instead of one per row.
        Map<String, Customer> byLowerName = new LinkedHashMap<>();
        Map<String, Customer> byPhone = new LinkedHashMap<>();
        if (!toApply.isEmpty()) {
            for (Customer c : customerRepository.findMatchingForImportBatch(
                    pharmacyId, nonEmpty(lowerNames), nonEmpty(phones))) {
                byLowerName.putIfAbsent(c.getName().trim().toLowerCase(Locale.ROOT), c);
                if (c.getPhone() != null) {
                    byPhone.putIfAbsent(c.getPhone(), c);
                }
            }
        }

        // Pass 2 — apply. Phone first: it is the stronger identifier (the old per-row
        // query returned an unordered list and took the first).
        for (ValidatedCustomerRow v : toApply) {
            String lowerName = v.name().trim().toLowerCase(Locale.ROOT);
            Customer match = v.phone() != null ? byPhone.get(v.phone()) : null;
            if (match == null) {
                match = byLowerName.get(lowerName);
            }
            List<Customer> matches = match == null ? List.of() : List.of(match);
            BigDecimal creditLimit = v.creditLimit() != null ? v.creditLimit() : BigDecimal.ZERO;
            if (matches.isEmpty()) {
                Customer c = Customer.create(pharmacyId, v.name());
                c.applyFields(v.name(), v.phone(), v.email(), v.address(), null, v.dateOfBirth(), v.gender(),
                        v.abhaNumber(), v.cardNumber(), creditLimit.signum() > 0 ? CustomerType.CREDIT : CustomerType.WALK_IN,
                        BigDecimal.ZERO, creditLimit, v.notes());
                if (v.openingDue() != null) {
                    c.adjustCreditUsed(v.openingDue());
                }
                customerRepository.save(c);
                createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.CUSTOMERS, c.getId()));
                // Index it so a later row matching on the other key reuses it (see commitSuppliers).
                byLowerName.putIfAbsent(lowerName, c);
                if (c.getPhone() != null) {
                    byPhone.putIfAbsent(c.getPhone(), c);
                }
                created++;
            } else {
                // Never overwrite creditUsed here — it tracks real unpaid invoices, not the import.
                Customer c = matches.get(0);
                c.applyFields(v.name(), v.phone(), v.email(), v.address(), c.getState(), v.dateOfBirth(), v.gender(),
                        v.abhaNumber(), v.cardNumber(), c.getCustomerType(), c.getDefaultDiscount(),
                        v.creditLimit() != null ? v.creditLimit() : c.getCreditLimit(), v.notes());
                customerRepository.save(c);
                updated++;
            }
        }

        int totalRows = parsed.rows().size();
        int failedRows = (int) issues.stream().filter(i -> "error".equals(i.severity())).map(RowIssue::row).distinct().count();
        writeJob(id, pharmacyId, MigrationEntityType.CUSTOMERS, totalRows, totalRows, created + updated, failedRows, issues);
        session.markStepCompleted("customers");
        return new CommitResult(MigrationEntityType.CUSTOMERS, totalRows, created + updated, failedRows, skipped, issues, null, false);
    }

    @Transactional
    public CommitResult commitDoctors(String id, String csvText, Map<String, String> columnMappings) {
        return commitMaybeAsync(MigrationEntityType.DOCTORS, id, csvText,
                () -> self().commitDoctorsSync(id, csvText, columnMappings));
    }

    @Transactional
    CommitResult commitDoctorsSync(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        Set<String> seenKeys = new java.util.HashSet<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;

        // Pass 1 — validate + de-duplicate within the file (see commitSuppliers).
        List<ValidatedDoctorRow> toApply = new ArrayList<>();
        Set<String> lowerNames = new LinkedHashSet<>();
        Set<String> registrationNos = new LinkedHashSet<>();
        for (var row : parsed.rows()) {
            Map<String, String> fields = csvParser.applyColumnMapping(row, columnMappings);
            ValidatedDoctorRow v = rowValidator.validateDoctorRow(row.rowNumber(), fields, issues);
            if (v == null) {
                continue;
            }
            String dedupKey = v.registrationNo() != null ? v.registrationNo() : v.name().trim().toLowerCase(Locale.ROOT);
            if (!seenKeys.add(dedupKey)) {
                issues.add(RowIssue.warning(row.rowNumber(), "doctorName", "Duplicate doctor in file — skipped"));
                skipped++;
                continue;
            }
            toApply.add(v);
            lowerNames.add(v.name().trim().toLowerCase(Locale.ROOT));
            if (v.registrationNo() != null) {
                registrationNos.add(v.registrationNo());
            }
        }

        // ONE query instead of one per row.
        Map<String, Doctor> byLowerName = new LinkedHashMap<>();
        Map<String, Doctor> byRegNo = new LinkedHashMap<>();
        if (!toApply.isEmpty()) {
            for (Doctor d : doctorRepository.findMatchingForImportBatch(
                    pharmacyId, nonEmpty(lowerNames), nonEmpty(registrationNos))) {
                byLowerName.putIfAbsent(d.getName().trim().toLowerCase(Locale.ROOT), d);
                if (d.getRegistrationNo() != null) {
                    byRegNo.putIfAbsent(d.getRegistrationNo(), d);
                }
            }
        }

        // Pass 2 — apply. Registration number first: the stronger identifier.
        for (ValidatedDoctorRow v : toApply) {
            String lowerName = v.name().trim().toLowerCase(Locale.ROOT);
            Doctor match = v.registrationNo() != null ? byRegNo.get(v.registrationNo()) : null;
            if (match == null) {
                match = byLowerName.get(lowerName);
            }
            List<Doctor> matches = match == null ? List.of() : List.of(match);
            if (matches.isEmpty()) {
                Doctor d = Doctor.create(pharmacyId, v.name());
                d.applyFields(v.name(), v.registrationNo(), v.specialty(), v.clinic(), v.phone(), v.email(), null);
                doctorRepository.save(d);
                createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.DOCTORS, d.getId()));
                byLowerName.putIfAbsent(lowerName, d);
                if (d.getRegistrationNo() != null) {
                    byRegNo.putIfAbsent(d.getRegistrationNo(), d);
                }
                created++;
            } else {
                Doctor d = matches.get(0);
                d.applyFields(v.name(), v.registrationNo(), v.specialty(), v.clinic(), v.phone(), v.email(), d.getAddress());
                doctorRepository.save(d);
                updated++;
            }
        }

        int totalRows = parsed.rows().size();
        int failedRows = (int) issues.stream().filter(i -> "error".equals(i.severity())).map(RowIssue::row).distinct().count();
        writeJob(id, pharmacyId, MigrationEntityType.DOCTORS, totalRows, totalRows, created + updated, failedRows, issues);
        session.markStepCompleted("doctors");
        return new CommitResult(MigrationEntityType.DOCTORS, totalRows, created + updated, failedRows, skipped, issues, null, false);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Settles the job row for a finished commit.
     *
     * <p>Completes the row a background dispatch already created, when there is one,
     * rather than creating a second. The wizard polls the job id it was handed at
     * dispatch — {@code commitResult.jobId} — so writing a fresh row here would leave
     * it watching an id that never reaches COMPLETED, and the import would appear to
     * run forever despite having finished.
     *
     * <p>At most one such row can exist: {@code commitMaybeAsync} refuses to start a
     * second import for the same session and entity type while one is unfinished.
     */
    private void writeJob(String sessionId, String pharmacyId, MigrationEntityType entityType, int totalRows,
                          int processedRows, int successRows, int failedRows, List<RowIssue> errors) {
        MigrationImportJob job = jobRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .filter(j -> j.getEntityType() == entityType)
                .filter(j -> j.getStatus() == ImportJobStatus.PROCESSING || j.getStatus() == ImportJobStatus.PENDING)
                .findFirst()
                .orElseGet(() -> MigrationImportJob.create(sessionId, pharmacyId, entityType, totalRows));
        job.complete(processedRows, successRows, failedRows, errors);
        jobRepository.save(job);
    }

    private MigrationSession loadSession(String id) {
        return sessionRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Migration session not found"));
    }

    /**
     * Pushes a batch of rows to the database and empties the persistence context.
     *
     * <p>A commit runs synchronously in one transaction and accepts up to
     * {@link #MAX_IMPORT_ROWS} rows, each creating several entities — an inventory
     * import creates three (batch, movement, rollback record). Without this, a
     * max-size file leaves ~150,000 entities managed at once: Hibernate re-checks
     * every one of them for changes on each flush, so the import gets slower the
     * longer it runs, on top of the memory it holds.
     *
     * <p>Clearing DETACHES everything, which is why the commit methods re-load the
     * session before writing its step status — an entity read before the clear is no
     * longer tracked, and changes to it would be silently dropped.
     *
     * <p>Nothing about atomicity changes: flush writes to the transaction, not past
     * it, so a failure at row 40,000 still rolls the whole import back.
     *
     * <p>DELIBERATELY ONLY USED BY THE INVENTORY COMMIT. That loop carries nothing
     * managed between iterations — its lookups are all maps of plain Strings — so
     * detaching is a no-op for it. The supplier, customer and doctor commits are the
     * opposite: they hold their deduplication maps full of managed entities and MUTATE
     * them in place when a row matches an existing record. Clearing underneath that
     * would leave those updates riding on detached instances, recovered only by
     * save()'s merge — an extra SELECT per row, and a correctness argument resting on
     * a subtlety. Stock files are also where the row counts actually are; a customer
     * list is not 50,000 rows long.
     */
    private void drainIfBatchFull(int rowsWritten) {
        if (rowsWritten > 0 && rowsWritten % PERSISTENCE_BATCH_SIZE == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }

    /**
     * Runs a commit in the background when the file is big enough to outlive a request.
     *
     * <p>Below the threshold nothing changes: the import runs inline and the pharmacist
     * gets their result immediately, which is the right experience for the small files
     * that are the common case. Above it, a PROCESSING job row is committed first and
     * the work is handed to {@link MigrationAsyncCommitter}; the wizard already polls
     * that row every three seconds.
     *
     * <p>The dispatch is registered as an AFTER-COMMIT callback, not fired inline. The
     * job row is written in this transaction, and a worker started before that
     * transaction commits would look for a row the database has not got yet — and, on
     * the failure path, would try to mark a job that never existed.
     */
    private MigrationService self() {
        return selfProvider.getObject();
    }

    private CommitResult commitMaybeAsync(MigrationEntityType entityType, String sessionId, String csvText,
                                          java.util.function.Supplier<CommitResult> work) {
        MigrationSession session = loadSession(sessionId);
        String pharmacyId = session.getPharmacyId();
        UserPrincipal principal = TenantContext.currentUser();

        int estimatedRows = estimateDataRows(csvText);
        if (estimatedRows <= ASYNC_ROW_THRESHOLD) {
            return work.get();
        }

        // One import per entity type per session at a time. Without this a double-click
        // starts two workers over the same file; the second would be skipped row by row
        // as a duplicate, but only after doing all the work to discover that.
        boolean alreadyRunning = jobRepository.findBySessionIdOrderByCreatedAtAsc(sessionId).stream()
                .anyMatch(j -> j.getEntityType() == entityType
                        && (j.getStatus() == ImportJobStatus.PROCESSING || j.getStatus() == ImportJobStatus.PENDING));
        if (alreadyRunning) {
            throw new ConflictException("This import is already running — watch its progress below "
                    + "rather than starting it again.");
        }

        MigrationImportJob job = MigrationImportJob.create(sessionId, pharmacyId, entityType, estimatedRows);
        jobRepository.save(job);
        String jobId = job.getId();

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                asyncCommitter.run(jobId, principal, work::get);
            }
        });

        log.info("Migration import {} ({} rows) dispatched to the background as job {}",
                entityType, estimatedRows, jobId);
        return new CommitResult(entityType, estimatedRows, 0, 0, 0, List.of(), jobId, true);
    }

    /**
     * Row count for the async threshold only — deliberately cheap.
     *
     * <p>Counts newlines rather than parsing, so a quoted field containing a line break
     * inflates it slightly. That is fine: this decides which side of a 500-row line the
     * file falls on, and the parser counts properly once the work starts.
     */
    private static int estimateDataRows(String csvText) {
        if (csvText == null || csvText.isBlank()) return 0;
        int lines = 0;
        for (int i = 0; i < csvText.length(); i++) {
            if (csvText.charAt(i) == '\n') lines++;
        }
        if (!csvText.endsWith("\n")) lines++;
        return Math.max(0, lines - 1); // minus the header
    }

    private void guardRowCount(int count) {
        if (count > MAX_IMPORT_ROWS) {
            throw new BadRequestException("This file has more than " + MAX_IMPORT_ROWS + " rows — please split it into smaller files");
        }
    }

    private void guardEmptyAndRowCount(int count) {
        if (count == 0) {
            throw new BadRequestException("CSV produced no data rows");
        }
        guardRowCount(count);
    }

    private SessionResponse toResponse(MigrationSession session) {
        List<ImportJobResponse> jobs = jobRepository.findBySessionIdOrderByCreatedAtAsc(session.getId())
                .stream().map(ImportJobResponse::from).toList();
        return SessionResponse.from(session, jobs);
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
