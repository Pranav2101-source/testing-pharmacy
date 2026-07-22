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
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * CSV-import onboarding wizard. The old Node backend dispatched imports over
 * ~500 rows to a pg-boss background worker; the Java rebuild has no
 * background-job runtime yet (see BACKLOG.md), so every commit here runs
 * synchronously within the request — {@code CommitResult.async} is always
 * false. The 50,000-row hard cap still applies. A {@link MigrationImportJob}
 * row is still written for every commit (immediately COMPLETED) purely so
 * {@code GET /migration/history} has something to read.
 */
@Service
public class MigrationService {

    private static final int MAX_IMPORT_ROWS = 50_000;
    private static final int MEDICINE_CANDIDATE_LIMIT = 50;
    private static final int MEDICINE_SUGGESTION_TOP_N = 3;

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
                            DoctorRepository doctorRepository) {
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
        for (var entityType : List.of(MigrationEntityType.INVENTORY, MigrationEntityType.MEDICINE,
                MigrationEntityType.SUPPLIERS, MigrationEntityType.CUSTOMERS, MigrationEntityType.DOCTORS)) {
            List<String> ids = createdRecordRepository.findBySessionIdAndEntityType(id, entityType).stream()
                    .map(MigrationCreatedRecord::getEntityId).toList();
            if (ids.isEmpty()) {
                continue;
            }
            rollbackEntity(entityType, ids, pharmacyId);
        }
        session.rollBack();
        return toResponse(session);
    }

    private void rollbackEntity(MigrationEntityType entityType, List<String> ids, String pharmacyId) {
        switch (entityType) {
            case INVENTORY -> deleteInventoryAndMovements(ids, pharmacyId);
            case MEDICINE -> medicineRepository.findAllById(ids).forEach(m -> {
                m.deactivate();
                medicineRepository.save(m);
            });
            case SUPPLIERS -> supplierRepository.deleteAll(supplierRepository.findAllById(ids).stream()
                    .filter(s -> s.getPharmacyId().equals(pharmacyId)).toList());
            case CUSTOMERS -> customerRepository.deleteAll(customerRepository.findAllById(ids).stream()
                    .filter(c -> c.getPharmacyId().equals(pharmacyId)).toList());
            case DOCTORS -> doctorRepository.deleteAll(doctorRepository.findAllById(ids).stream()
                    .filter(d -> d.getPharmacyId().equals(pharmacyId)).toList());
        }
    }

    private void deleteInventoryAndMovements(List<String> inventoryIds, String pharmacyId) {
        // Movements this session created all carry referenceType OPENING_BALANCE — delete those first
        // (FK dependency: a movement references its inventory row).
        inventoryMovementRepository.deleteAll(
                inventoryMovementRepository.findByInventoryIdInAndReferenceType(inventoryIds, "OPENING_BALANCE"));
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

    @Transactional
    public List<MedicineMappingResponse> confirmMedicineMappings(String id, MedicineMappingsRequest req) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        var principal = TenantContext.currentUser();

        List<MedicineMappingResponse> result = new ArrayList<>();
        for (var entry : req.mappings()) {
            if (entry.csvValue() == null || entry.csvValue().isBlank()) {
                continue;
            }
            String csvValue = entry.csvValue().trim().toLowerCase(Locale.ROOT);
            MedicineMapping mapping = mappingRepository.findByPharmacyIdAndCsvValue(pharmacyId, csvValue)
                    .orElseGet(() -> MedicineMapping.create(pharmacyId, csvValue));
            mapping.confirm(entry.medicineId(), entry.isNew(), principal.userId());
            mappingRepository.save(mapping);
            result.add(MedicineMappingResponse.from(mapping));
        }
        return result;
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
                    "OPENING_BALANCE", id, "Imported via migration wizard");
            inventoryMovementRepository.save(movement);
            createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.INVENTORY, inv.getId()));
            successCount++;
        }

        int totalRows = parsed.rows().size();
        writeJob(id, pharmacyId, MigrationEntityType.INVENTORY, totalRows, totalRows, successCount, failedCount, issues);
        session.markStepCompleted("commit-inventory");

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
                Medicine existing = medicineRepository.findActiveByLowerNameIn(List.of(lower)).stream().findFirst().orElse(null);
                if (existing != null) {
                    medicineId = existing.getId();
                } else {
                    Medicine created = Medicine.create(capitalize(displayName), new BigDecimal("12"));
                    medicineRepository.save(created);
                    medicineId = created.getId();
                    createdRecordRepository.save(MigrationCreatedRecord.create(sessionId, MigrationEntityType.MEDICINE, medicineId));
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

    private static String capitalize(String s) {
        if (s.isBlank()) {
            return s;
        }
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    // ── Commit: suppliers / customers / doctors ─────────────────────────────

    @Transactional
    public CommitResult commitSuppliers(String id, String csvText, Map<String, String> columnMappings) {
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        Set<String> seenKeys = new java.util.HashSet<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;

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

            List<Supplier> matches = supplierRepository.findMatchingForImport(pharmacyId, v.name(), v.gstin());
            if (matches.isEmpty()) {
                Supplier s = Supplier.create(pharmacyId, v.name());
                s.applyFields(v.name(), v.gstin(), v.dlNumber(), v.phone(), v.email(), v.address(), v.city(), v.state(),
                        BigDecimal.ZERO, v.creditDays() != null ? v.creditDays() : 30, null);
                if (v.openingBalance() != null) {
                    s.adjustLedgerBalance(v.openingBalance());
                }
                supplierRepository.save(s);
                createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.SUPPLIERS, s.getId()));
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
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        Set<String> seenKeys = new java.util.HashSet<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;

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

            List<Customer> matches = customerRepository.findMatchingForImport(pharmacyId, v.name(), v.phone());
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
        MigrationSession session = loadSession(id);
        String pharmacyId = session.getPharmacyId();
        ParsedCsv parsed = csvParser.parse(csvText);
        guardEmptyAndRowCount(parsed.rows().size());

        List<RowIssue> issues = new ArrayList<>();
        Set<String> seenKeys = new java.util.HashSet<>();
        int created = 0;
        int updated = 0;
        int skipped = 0;

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

            List<Doctor> matches = doctorRepository.findMatchingForImport(pharmacyId, v.name(), v.registrationNo());
            if (matches.isEmpty()) {
                Doctor d = Doctor.create(pharmacyId, v.name());
                d.applyFields(v.name(), v.registrationNo(), v.specialty(), v.clinic(), v.phone(), v.email(), null);
                doctorRepository.save(d);
                createdRecordRepository.save(MigrationCreatedRecord.create(id, MigrationEntityType.DOCTORS, d.getId()));
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

    private void writeJob(String sessionId, String pharmacyId, MigrationEntityType entityType, int totalRows,
                          int processedRows, int successRows, int failedRows, List<RowIssue> errors) {
        MigrationImportJob job = MigrationImportJob.create(sessionId, pharmacyId, entityType, totalRows);
        job.complete(processedRows, successRows, failedRows, errors);
        jobRepository.save(job);
    }

    private MigrationSession loadSession(String id) {
        return sessionRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Migration session not found"));
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
