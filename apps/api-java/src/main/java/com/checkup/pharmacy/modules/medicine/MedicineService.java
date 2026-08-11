package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.exception.AppException;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.StableSort;
import com.checkup.pharmacy.modules.medicine.dto.AlternativeResponse;
import com.checkup.pharmacy.modules.medicine.dto.BulkImportRequest;
import com.checkup.pharmacy.modules.medicine.dto.BulkImportResponse;
import com.checkup.pharmacy.modules.medicine.dto.CreateMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.MedicinePageResponse;
import com.checkup.pharmacy.modules.medicine.dto.MedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.OverrideResponse;
import com.checkup.pharmacy.modules.medicine.dto.ReindexResponse;
import com.checkup.pharmacy.modules.medicine.dto.UpdateMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.UpsertOverrideRequest;
import com.checkup.pharmacy.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The shared medicine catalog. Reads and single-record create are open to any
 * authenticated user; edits/deactivation are PLATFORM_ADMIN-only (enforced by
 * the controller) since they affect every tenant. Pharmacy-level customization
 * goes through the override methods, which ARE tenant-scoped.
 */
@Service
public class MedicineService {

    private static final Logger log = LoggerFactory.getLogger(MedicineService.class);

    private static final Set<BigDecimal> ALLOWED_GST_RATES =
            Set.of(BigDecimal.ZERO, BigDecimal.valueOf(5), BigDecimal.valueOf(12), BigDecimal.valueOf(18));
    private static final BigDecimal DEFAULT_GST_RATE = BigDecimal.valueOf(12);
    // Matches the frontend's advertised "Max 5,000 rows" (BulkUploadModal) — reject
    // oversized payloads outright rather than let them tie up a long transaction.
    private static final int MAX_BULK_ROWS = 5000;

    /** Below this many sellable units a batch-set is flagged low_stock (matches the old Node backend). */
    private static final int LOW_STOCK_QTY = 10;

    private final MedicineRepository medicineRepository;
    private final PharmacyMedicineOverrideRepository overrideRepository;
    private final com.checkup.pharmacy.modules.inventory.InventoryRepository inventoryRepository;

    public MedicineService(MedicineRepository medicineRepository,
                           PharmacyMedicineOverrideRepository overrideRepository,
                           com.checkup.pharmacy.modules.inventory.InventoryRepository inventoryRepository) {
        this.medicineRepository = medicineRepository;
        this.overrideRepository = overrideRepository;
        this.inventoryRepository = inventoryRepository;
    }

    @Transactional(readOnly = true)
    public MedicinePageResponse list(String search, String schedule, String form, Boolean isActive,
                                     int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        PageRequest pageRequest = PageRequest.of(safePage - 1, safeLimit, StableSort.of(Sort.by("name").ascending()));

        Page<Medicine> result = medicineRepository.search(
                blankToNull(search), blankToNull(schedule), blankToNull(form), isActive, pageRequest);

        List<MedicineResponse> items = result.getContent().stream().map(this::toResponse).toList();
        return new MedicinePageResponse(items, result.getTotalElements(), safePage, result.getTotalPages());
    }

    @Transactional
    public MedicineResponse create(CreateMedicineRequest req) {
        String name = req.name().trim();
        BigDecimal gstRate = validateGstRate(req.gstRate());

        if (medicineRepository.existsActiveDuplicate(name, req.manufacturer())) {
            throw new ConflictException("A medicine with this name and manufacturer already exists");
        }

        Medicine medicine = Medicine.create(name, gstRate);
        medicine.applyFields(req.genericName(), req.manufacturer(), req.composition(), req.category(),
                req.schedule(), req.hsnCode(), gstRate, req.form(), req.strength(), req.unit(), req.packSize());
        medicineRepository.save(medicine);
        return toResponse(medicine);
    }

    @Transactional
    public MedicineResponse update(String id, UpdateMedicineRequest req) {
        Medicine medicine = load(id);
        BigDecimal gstRate = validateGstRate(req.gstRate());
        String name = req.name().trim();
        if (medicineRepository.existsActiveDuplicateExcludingId(name, req.manufacturer(), id)) {
            throw new ConflictException("A medicine with this name and manufacturer already exists");
        }
        medicine.rename(name);
        medicine.applyFields(req.genericName(), req.manufacturer(), req.composition(), req.category(),
                req.schedule(), req.hsnCode(), gstRate, req.form(), req.strength(), req.unit(), req.packSize());
        return toResponse(medicine);
    }

    @Transactional
    public MedicineResponse deactivate(String id) {
        Medicine medicine = load(id);
        medicine.deactivate();
        return toResponse(medicine);
    }

    @Transactional
    public MedicineResponse activate(String id) {
        Medicine medicine = load(id);
        medicine.activate();
        return toResponse(medicine);
    }

    /**
     * Best-effort import: each row is independent so one bad row never aborts the
     * batch. A row is skipped (not failed) when it duplicates an existing active
     * medicine (matches the frontend's "skipped (duplicates)" wording).
     *
     * Duplicate detection is batched: one query fetches every existing active
     * medicine whose name matches any row in the file, instead of one EXISTS
     * query per row — a 5,000-row import does ~1 duplicate-lookup query instead
     * of 5,000. Within-file duplicates (two rows in the same upload sharing a
     * name+manufacturer) are also caught, so the first is added and the rest
     * skipped rather than every one being inserted.
     */
    @Transactional
    public BulkImportResponse bulkImport(BulkImportRequest req) {
        if (req.rows() == null || req.rows().isEmpty()) {
            throw new BadRequestException("No rows to import");
        }
        if (req.rows().size() > MAX_BULK_ROWS) {
            throw new BadRequestException("Cannot import more than " + MAX_BULK_ROWS + " rows at once");
        }

        Set<String> lowerNames = req.rows().stream()
                .map(BulkImportRequest.Row::name)
                .filter(n -> n != null && !n.isBlank())
                .map(n -> n.trim().toLowerCase(Locale.ROOT))
                .collect(Collectors.toSet());
        // Guard against an empty IN () clause — e.g. every row had a blank name —
        // which Hibernate/Postgres can reject outright.
        Set<String> seenKeys = lowerNames.isEmpty()
                ? new HashSet<>()
                : medicineRepository.findActiveByLowerNameIn(lowerNames).stream()
                        .map(m -> dedupeKey(m.getName(), m.getManufacturer()))
                        .collect(Collectors.toCollection(HashSet::new));

        int added = 0;
        int skipped = 0;
        int failed = 0;
        List<String> errors = new ArrayList<>();

        for (BulkImportRequest.Row row : req.rows()) {
            try {
                String name = row.name() == null ? "" : row.name().trim();
                if (name.isEmpty()) {
                    failed++;
                    errors.add("Row skipped: name is required");
                    continue;
                }
                String key = dedupeKey(name, row.manufacturer());
                if (!seenKeys.add(key)) {
                    // add() returns false when the key was already present — either an
                    // existing catalog entry or an earlier row in this same file.
                    skipped++;
                    continue;
                }
                BigDecimal gstRate = validateGstRate(row.gstRate());
                Medicine medicine = Medicine.create(name, gstRate);
                medicine.applyFields(row.genericName(), row.manufacturer(), row.composition(), row.category(),
                        row.schedule(), row.hsnCode(), gstRate, row.form(), row.strength(), row.unit(), row.packSize());
                medicineRepository.save(medicine);
                added++;
            } catch (AppException e) {
                // Validation-style failure (e.g. bad gstRate) — safe, developer-authored
                // message, fine to surface to the caller.
                failed++;
                errors.add((row.name() == null ? "(no name)" : row.name()) + ": " + e.getMessage());
            } catch (Exception e) {
                // Unexpected failure — do NOT echo e.getMessage() to the client (could leak
                // internals like raw SQL errors); log it server-side instead, same policy
                // as the global catch-all.
                failed++;
                errors.add((row.name() == null ? "(no name)" : row.name()) + ": failed due to an unexpected error");
                log.warn("Bulk medicine import: unexpected failure on row '{}'", row.name(), e);
            }
        }

        return new BulkImportResponse(added, skipped, failed, errors);
    }

    private static String dedupeKey(String name, String manufacturer) {
        String n = name.trim().toLowerCase(Locale.ROOT);
        String m = manufacturer == null ? "" : manufacturer.trim().toLowerCase(Locale.ROOT);
        return n + "|" + m;
    }

    /**
     * Recomputes the searchable count. A placeholder until the catalog is
     * actually pushed to Meilisearch (backlog D2) — today it simply reports how
     * many active medicines exist, which is at least an honest signal rather
     * than a fabricated "success".
     */
    @Transactional(readOnly = true)
    public ReindexResponse reindex() {
        return new ReindexResponse(medicineRepository.countByIsActiveTrue());
    }

    @Transactional(readOnly = true)
    public List<OverrideResponse> listMyOverrides() {
        return overrideRepository.findByIdPharmacyId(TenantContext.pharmacyId()).stream()
                .map(this::toOverrideResponse)
                .toList();
    }

    @Transactional
    public OverrideResponse upsertOverride(String medicineId, UpsertOverrideRequest req) {
        if (req.gstRate() == null && req.defaultDiscountPct() == null) {
            throw new BadRequestException("Set a GST rate and/or a default discount — or remove the override");
        }
        // The override's GST dropdown offers the same {0,5,12,18} set as the base
        // catalog (see OverrideModal on the frontend) — enforce it here too, not
        // just on the main create/update path, so an override can't silently carry
        // a value the rest of the system would reject.
        if (req.gstRate() != null) {
            validateGstRate(req.gstRate());
        }
        // Validates the medicine exists before allowing an override to be attached to it.
        load(medicineId);

        String pharmacyId = TenantContext.pharmacyId();
        PharmacyMedicineOverride override = overrideRepository
                .findByIdPharmacyIdAndIdMedicineId(pharmacyId, medicineId)
                .orElseGet(() -> PharmacyMedicineOverride.create(pharmacyId, medicineId));
        override.update(req.gstRate(), req.defaultDiscountPct(), req.notes());
        overrideRepository.save(override);
        return toOverrideResponse(override);
    }

    @Transactional
    public void removeOverride(String medicineId) {
        overrideRepository.deleteByIdPharmacyIdAndIdMedicineId(TenantContext.pharmacyId(), medicineId);
    }

    /** Quick fuzzy search for the billing/GRN combobox — active medicines only, capped by limit. */
    @Transactional(readOnly = true)
    public List<MedicineResponse> quickSearch(String q, int limit) {
        String trimmed = q == null ? "" : q.trim();
        if (trimmed.isEmpty()) {
            return List.of();
        }
        int safeLimit = Math.min(Math.max(limit, 1), 50);
        return medicineRepository.quickSearch(trimmed, PageRequest.of(0, safeLimit)).stream()
                .map(this::toResponse).toList();
    }

    /** Exact barcode lookup — returns any status (active or not) so the caller can surface a
     *  specific "discontinued" message rather than a misleading "not found". */
    @Transactional(readOnly = true)
    public MedicineResponse findByBarcode(String barcode) {
        return medicineRepository.findByBarcode(barcode)
                .map(this::toResponse)
                .orElseThrow(() -> new NotFoundException("No medicine is linked to barcode \"" + barcode + "\""));
    }

    /**
     * Links a barcode to a medicine. Open to any authenticated staff member (unlike the general
     * PLATFORM_ADMIN-gated edit) since this is a routine POS/receiving task — a cashier scanning
     * an unrecognized product and pointing it at the right catalog entry, not a catalog edit.
     */
    @Transactional
    public MedicineResponse setBarcode(String id, String barcode) {
        String trimmed = barcode == null ? "" : barcode.trim();
        if (trimmed.isEmpty()) {
            throw new BadRequestException("Barcode is required");
        }
        Medicine medicine = load(id);
        if (medicineRepository.existsByBarcodeAndIdNot(trimmed, id)) {
            throw new ConflictException("This barcode is already linked to another medicine");
        }
        medicine.setBarcode(trimmed);
        return toResponse(medicine);
    }

    /**
     * Narrow classification update (category/packaging free-text) — open to OWNER/MANAGER
     * (enforced by the controller), unlike the PLATFORM_ADMIN-gated full edit, so staff can
     * enrich the shared catalog from the inventory/POS workflow over time. Each field is
     * trimmed; an empty value is stored as null.
     */
    @Transactional
    public MedicineResponse setClassification(String id, String category, String unit) {
        Medicine medicine = load(id);
        medicine.setClassification(blankToNull(category), blankToNull(unit));
        return toResponse(medicine);
    }

    /**
     * Generic-substitution alternatives for the billing POS drawer: other active medicines
     * sharing this one's genericName (+ same strength/form), each enriched with the caller
     * pharmacy's own live (ACTIVE, non-expired) stock and its per-pharmacy GST override, so
     * the rates shown match what billing checkout will compute. Returns [] when the source
     * has no genericName (no meaningful substitution).
     */
    @Transactional(readOnly = true)
    public List<AlternativeResponse> getAlternatives(String id, String pharmacyId) {
        Medicine source = load(id);
        if (source.getGenericName() == null || source.getGenericName().isBlank()) {
            return List.of();
        }

        List<Medicine> alternatives = medicineRepository.findAlternatives(
                source.getGenericName(), source.getStrength(), source.getForm(), id);
        if (alternatives.isEmpty()) {
            return List.of();
        }

        List<String> medicineIds = alternatives.stream().map(Medicine::getId).toList();
        java.util.Map<String, List<com.checkup.pharmacy.modules.inventory.Inventory>> batchesByMedicine =
                inventoryRepository.findActiveNonExpiredByMedicineIdIn(pharmacyId, medicineIds, java.time.Instant.now())
                        .stream().collect(Collectors.groupingBy(
                                com.checkup.pharmacy.modules.inventory.Inventory::getMedicineId));

        // Scoped to the alternatives on screen. This drawer opens from the billing
        // cart, and the unbounded variant read every override the pharmacy had set to
        // use at most a handful.
        java.util.Map<String, BigDecimal> overrideGst = new java.util.HashMap<>();
        for (PharmacyMedicineOverride o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medicineIds)) {
            if (o.getGstRate() != null) {
                overrideGst.put(o.getMedicineId(), o.getGstRate());
            }
        }

        List<AlternativeResponse> result = new ArrayList<>();
        for (Medicine med : alternatives) {
            List<com.checkup.pharmacy.modules.inventory.Inventory> batches =
                    batchesByMedicine.getOrDefault(med.getId(), List.of());

            int totalStock = batches.stream().mapToInt(b -> b.getQuantity() - b.getReservedQuantity()).sum();
            BigDecimal mrp = batches.stream().map(com.checkup.pharmacy.modules.inventory.Inventory::getMrp)
                    .max(BigDecimal::compareTo).orElse(BigDecimal.ZERO);
            BigDecimal margin = null;
            if (!batches.isEmpty() && mrp.signum() > 0) {
                BigDecimal avgRate = batches.stream().map(com.checkup.pharmacy.modules.inventory.Inventory::getPurchaseRate)
                        .reduce(BigDecimal.ZERO, BigDecimal::add)
                        .divide(BigDecimal.valueOf(batches.size()), 4, java.math.RoundingMode.HALF_UP);
                margin = mrp.subtract(avgRate).divide(mrp, 4, java.math.RoundingMode.HALF_UP)
                        .multiply(BigDecimal.valueOf(100)).setScale(2, java.math.RoundingMode.HALF_UP);
            }
            String stockStatus = totalStock == 0 ? "out_of_stock"
                    : totalStock <= LOW_STOCK_QTY ? "low_stock" : "in_stock";

            List<AlternativeResponse.Batch> batchDtos = batches.stream()
                    .map(b -> new AlternativeResponse.Batch(b.getId(), b.getBatchNumber(), b.getExpiryDate(),
                            b.getQuantity(), b.getReservedQuantity(), b.getMrp(), b.getPurchaseRate(), b.getLocation()))
                    .toList();

            result.add(new AlternativeResponse(med.getId(), med.getName(), med.getManufacturer(), med.getGenericName(),
                    med.getStrength(), med.getForm(), med.getPackSize(), med.getHsnCode(),
                    overrideGst.getOrDefault(med.getId(), med.getGstRate()), med.getSchedule(),
                    null, totalStock, mrp, margin, stockStatus, batchDtos));
        }
        return result;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private Medicine load(String id) {
        return medicineRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Medicine not found"));
    }

    private BigDecimal validateGstRate(BigDecimal requested) {
        BigDecimal rate = requested == null ? DEFAULT_GST_RATE : requested;
        boolean allowed = ALLOWED_GST_RATES.stream().anyMatch(a -> a.compareTo(rate) == 0);
        if (!allowed) {
            throw new BadRequestException("gstRate must be 0, 5, 12, or 18");
        }
        return rate;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private MedicineResponse toResponse(Medicine m) {
        return new MedicineResponse(
                m.getId(), m.getName(), m.getGenericName(), m.getManufacturer(), m.getComposition(),
                m.getCategory(), m.getSchedule(), m.getHsnCode(), m.getGstRate(), m.getForm(),
                m.getStrength(), m.getUnit(), m.getPackSize(), m.isActive());
    }

    private OverrideResponse toOverrideResponse(PharmacyMedicineOverride o) {
        return new OverrideResponse(o.getMedicineId(), o.getGstRate(), o.getDefaultDiscountPct(), o.getNotes());
    }
}
