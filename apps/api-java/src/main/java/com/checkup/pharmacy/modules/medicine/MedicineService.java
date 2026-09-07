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
import com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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

    private static final BigDecimal DEFAULT_GST_RATE = BigDecimal.valueOf(12);
    // Matches the frontend's advertised "Max 5,000 rows" (BulkUploadModal) — reject
    // oversized payloads outright rather than let them tie up a long transaction.
    private static final int MAX_BULK_ROWS = 5000;

    /**
     * Below this many sellable units a batch-set is flagged low_stock (matches the old Node backend).
     *
     * <p>Public because the EMR stock lookup ({@code ClinicStockService}) classifies the same
     * shelf for a prescriber's screen. A second copy of the number there would let the clinic's
     * badge and this pharmacy's own alternatives drawer disagree about whether a medicine is
     * running out, which is a disagreement nobody would think to look for.
     */
    public static final int LOW_STOCK_QTY = 10;

    private final MedicineRepository medicineRepository;
    private final PharmacyMedicineOverrideRepository overrideRepository;
    private final com.checkup.pharmacy.modules.inventory.InventoryRepository inventoryRepository;
    private final PharmacyMedicineRepository pharmacyMedicineRepository;

    public MedicineService(MedicineRepository medicineRepository,
                           PharmacyMedicineOverrideRepository overrideRepository,
                           com.checkup.pharmacy.modules.inventory.InventoryRepository inventoryRepository,
                           PharmacyMedicineRepository pharmacyMedicineRepository) {
        this.medicineRepository = medicineRepository;
        this.overrideRepository = overrideRepository;
        this.inventoryRepository = inventoryRepository;
        this.pharmacyMedicineRepository = pharmacyMedicineRepository;
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
        medicine.setPackaging(req.unitsPerPack(), normalizeBaseUnit(req.baseUnit()));
        medicineRepository.save(medicine);
        return toResponse(medicine);
    }

    private static final Set<String> BASE_UNITS = Set.of("TABLET", "CAPSULE", "ML", "GM", "EACH");

    private static String normalizeBaseUnit(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String v = raw.trim().toUpperCase(Locale.ROOT);
        if (!BASE_UNITS.contains(v)) {
            throw new BadRequestException("Base unit must be one of TABLET, CAPSULE, ML, GM, EACH.");
        }
        return v;
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
        medicine.setPackaging(req.unitsPerPack(), normalizeBaseUnit(req.baseUnit()));
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
        List<PharmacyMedicineOverride> overrides = overrideRepository.findByIdPharmacyId(TenantContext.pharmacyId());
        Map<String, Integer> catalogueUppById = new HashMap<>();
        for (Medicine m : medicineRepository.findAllById(
                overrides.stream().map(PharmacyMedicineOverride::getMedicineId).toList())) {
            catalogueUppById.put(m.getId(), m.getUnitsPerPack());
        }
        return overrides.stream()
                .map(o -> toOverrideResponse(o, catalogueUppById.get(o.getMedicineId())))
                .toList();
    }

    @Transactional
    public OverrideResponse upsertOverride(String medicineId, UpsertOverrideRequest req) {
        // Validates the medicine exists before allowing an override to be attached to it.
        Medicine medicine = load(medicineId);
        PharmacyMedicineOverride existing = overrideRepository
                .findByIdPharmacyIdAndIdMedicineId(TenantContext.pharmacyId(), medicineId)
                .orElse(null);
        return doUpsertOverride(medicine, existing, req);
    }

    /**
     * The actual upsert, taking an already-resolved {@link Medicine} and its (nullable)
     * existing override rather than ids to look up. Split out of {@link #upsertOverride}
     * so {@link #bulkEnableLoose} can reuse the two batch-loaded maps it already fetched
     * for validation, instead of every row in its loop re-querying both a Medicine and
     * an Override by id that the caller is holding in memory two lines away.
     */
    private OverrideResponse doUpsertOverride(Medicine medicine, PharmacyMedicineOverride existing, UpsertOverrideRequest req) {
        if (req.isEmpty()) {
            throw new BadRequestException(
                    "Nothing to save — set a GST rate, a default discount, loose selling, or a pack size. "
                    + "To clear an existing override, remove it instead.");
        }
        // The override's GST dropdown offers the same {0,5,12,18} set as the base
        // catalog (see OverrideModal on the frontend) — enforce it here too, not
        // just on the main create/update path, so an override can't silently carry
        // a value the rest of the system would reject.
        if (req.gstRate() != null) {
            validateGstRate(req.gstRate());
        }

        String pharmacyId = TenantContext.pharmacyId();
        PharmacyMedicineOverride override = existing != null
                ? existing : PharmacyMedicineOverride.create(pharmacyId, medicine.getId());

        // ── Loose-POS settings ────────────────────────────────────────────────
        // A null field on the request means "leave as it was", so unrelated edits
        // (a GST tweak) don't silently reset loose selling.
        boolean allowLoose = req.allowLooseSale() != null ? req.allowLooseSale() : override.isAllowLooseSale();
        Integer overrideUpp = req.unitsPerPack() != null ? req.unitsPerPack() : override.getUnitsPerPack();
        Integer effectiveUpp = overrideUpp != null ? overrideUpp : medicine.getUnitsPerPack();
        boolean looseByDefault = req.looseByDefault() != null ? req.looseByDefault() : override.isLooseByDefault();
        // The pharmacist confirming THIS request, right now — distinct from "was ever
        // confirmed at some point", which says nothing about whether today's number was
        // checked. Used only for the trust check below; persistToLooseConfirmedAt (fed
        // to applyLoosePos further down) is the "ever or now" version, which is fine
        // there because stamping looseConfirmedAt is idempotent once already set.
        boolean confirmedNow = Boolean.TRUE.equals(req.confirmed());
        boolean persistToLooseConfirmedAt = confirmedNow || override.getLooseConfirmedAt() != null;
        // A default-to-loose flag is meaningless without loose selling on.
        if (looseByDefault && !allowLoose) {
            looseByDefault = false;
        }

        if (allowLoose && (effectiveUpp == null || effectiveUpp < 2)) {
            throw new BadRequestException("\"" + medicine.getName() + "\" has no pack size on record, so it can't be "
                    + "sold loose. Enter how many " + baseUnitLabel(medicine) + " are in one pack.");
        }
        String schedule = medicine.getSchedule() == null ? "" : medicine.getSchedule().trim().toUpperCase(Locale.ROOT);
        if (allowLoose && schedule.equals("X")) {
            throw new BadRequestException("Schedule X medicines must be sold in the original pack — loose selling "
                    + "cannot be enabled for \"" + medicine.getName() + "\".");
        }
        // A wrong pack size silently over- or under-charges every loose sale of the
        // medicine, forever — so this checks EVERY request that would leave loose
        // selling on with a given pack size, not just the first time it's turned on.
        // (An earlier version only guarded `!override.isAllowLooseSale()` — the
        // first-enable transition — so a pack-size change on an ALREADY-loose medicine
        // skipped this check entirely and got persisted unverified.) Trusted = the
        // pharmacist confirming THIS number now, OR it's not actually changing from
        // whatever pharmacy-set value is already on record, OR — only when there is no
        // pharmacy-set value yet — it matches the platform-managed catalogue's own
        // number. A caller-supplied number that differs from what's on record, with no
        // confirmation, is refused; the POS dialog requires the tick, this is the
        // API-level backstop. A request that never touches unitsPerPack (null = "leave
        // as it was") always counts as unchanged, so toggling unrelated fields (GST,
        // discount) on an already-loose medicine is unaffected.
        Integer trustedUpp = override.getUnitsPerPack();
        boolean unchanged = req.unitsPerPack() == null
                || (trustedUpp != null && req.unitsPerPack().equals(trustedUpp));
        boolean matchesCatalogueWithNoOverrideYet = trustedUpp == null
                && medicine.getUnitsPerPack() != null
                && (req.unitsPerPack() == null || req.unitsPerPack().equals(medicine.getUnitsPerPack()));
        boolean trustedPackSize = confirmedNow || unchanged || matchesCatalogueWithNoOverrideYet;
        if (allowLoose && !trustedPackSize) {
            throw new BadRequestException("Check the pack size for \"" + medicine.getName()
                    + "\" against a real strip and confirm it before turning loose selling on.");
        }

        if (req.gstRate() != null || req.defaultDiscountPct() != null || req.notes() != null) {
            override.update(
                    req.gstRate() != null ? req.gstRate() : override.getGstRate(),
                    req.defaultDiscountPct() != null ? req.defaultDiscountPct() : override.getDefaultDiscountPct(),
                    req.notes() != null ? req.notes() : override.getNotes());
        }
        override.applyLoosePos(allowLoose, overrideUpp, looseByDefault, persistToLooseConfirmedAt);
        overrideRepository.save(override);
        return toOverrideResponse(override, medicine.getUnitsPerPack());
    }

    private static String baseUnitLabel(Medicine m) {
        String b = m.getBaseUnit();
        if (b == null) {
            return "units";
        }
        return switch (b) {
            case "TABLET" -> "tablets";
            case "CAPSULE" -> "capsules";
            case "ML" -> "millilitres";
            case "GM" -> "grams";
            default -> "units";
        };
    }

    @Transactional
    public void removeOverride(String medicineId) {
        overrideRepository.deleteByIdPharmacyIdAndIdMedicineId(TenantContext.pharmacyId(), medicineId);
    }

    /**
     * Narrow POS action — turn loose selling on/off for one medicine at this
     * pharmacy (OWNER/MANAGER only, see the controller). Reuses the override upsert
     * so all the validation (needs a pack size, not Schedule X) lives in one place.
     */
    @Transactional
    public OverrideResponse setLoosePosSettings(String medicineId, LoosePosSettingsRequest req) {
        return upsertOverride(medicineId, new UpsertOverrideRequest(
                null, null, null, req.allowLooseSale(), req.unitsPerPack(), req.looseByDefault(), req.confirmed()));
    }

    /**
     * Turn loose selling on for many medicines in one go. Fails the whole batch on
     * the first bad row (missing pack size, Schedule X) so the caller can fix and
     * retry — a partial enable is worse than none.
     *
     * <p>Bulk is deliberately narrower than the per-medicine dialog: it NEVER trusts
     * a client-supplied pack size and NEVER marks a size "confirmed". A wrong pack
     * size silently misprices every loose sale of that medicine, and bulk has no
     * strip to check it against — so it only flips the switch on for medicines whose
     * size is already on record (the catalogue's, or one this pharmacy already
     * entered and confirmed). Everything else is enabled one at a time, where the
     * dialog shows the size and requires the "I checked a real strip" tick.
     */
    @Transactional
    public List<OverrideResponse> bulkEnableLoose(List<BulkLooseRow> rows) {
        String pharmacyId = TenantContext.pharmacyId();
        List<String> ids = rows.stream().map(BulkLooseRow::medicineId).distinct().toList();
        Map<String, Medicine> medicinesById = new HashMap<>();
        for (Medicine m : medicineRepository.findAllById(ids)) {
            medicinesById.put(m.getId(), m);
        }
        Map<String, PharmacyMedicineOverride> overridesById = overridesByMedicineId(ids);

        List<OverrideResponse> out = new ArrayList<>();
        for (BulkLooseRow row : rows) {
            Medicine m = medicinesById.get(row.medicineId());
            if (m == null) {
                throw new NotFoundException("Medicine not found: " + row.medicineId());
            }
            PharmacyMedicineOverride ov = overridesById.get(row.medicineId());
            Integer structuredUpp = ov != null && ov.getUnitsPerPack() != null
                    ? ov.getUnitsPerPack() : m.getUnitsPerPack();
            if (structuredUpp == null || structuredUpp < 2) {
                throw new BadRequestException("\"" + m.getName() + "\" has no pack size on record. "
                        + "Enable loose selling for it individually so you can enter and confirm the pack size.");
            }
            // Reuses the Medicine/Override rows already batch-loaded above instead of
            // routing through setLoosePosSettings, which would re-fetch both by id —
            // the N+1 this method's own batching was otherwise defeated by.
            // unitsPerPack null → keep whatever is already on record; confirmed null → not stamped.
            out.add(doUpsertOverride(m, ov, new UpsertOverrideRequest(
                    null, null, null, true, null, row.looseByDefault(), null)));
        }
        return out;
    }

    /** {@code unitsPerPack} is accepted for wire compatibility but ignored — see {@link #bulkEnableLoose}. */
    public record BulkLooseRow(String medicineId, Integer unitsPerPack, Boolean looseByDefault) {
    }

    /**
     * Quick search for the billing/GRN combobox — active medicines only, capped by limit.
     *
     * <p>Substring/prefix hits (see {@link MedicineRepository#quickSearch}) come first,
     * exactly as before. If those don't fill the requested limit, tops up with
     * {@link MedicineRepository#fuzzySearch} results — a typo ("paracetmol") or a
     * transposed word ("500mg paracetamol") matches nothing as a literal substring,
     * but trigram similarity finds it. Never lets a fuzzy guess outrank a real
     * substring match; it only ever fills the seats a substring search left empty.
     */
    @Transactional(readOnly = true)
    public List<MedicineResponse> quickSearch(String q, int limit) {
        return quickSearch(q, limit, false);
    }

    /**
     * {@code includeLocal} additionally merges this pharmacy's own not-yet-catalogued
     * medicines (see {@link PharmacyMedicine}) that a GRN received, matched by name and
     * appended only after every catalogue hit — a real catalogue entry always wins a
     * tie, and local results only ever fill seats the catalogue search left empty.
     * {@code LINKED} local medicines are excluded: those already have a usable global
     * identity, so surfacing both would just be the same product twice.
     *
     * <p>Only the billing combobox opts into this. Every other caller of this endpoint
     * (Add Stock, barcode mapping, the alternatives drawer) writes against a global
     * {@code medicineId} and must keep seeing catalogue-only results — a local
     * medicine's id is a {@code PharmacyMedicine} id, meaningless to those flows.
     */
    @Transactional(readOnly = true)
    public List<MedicineResponse> quickSearch(String q, int limit, boolean includeLocal) {
        String trimmed = q == null ? "" : q.trim();
        if (trimmed.isEmpty()) {
            return List.of();
        }
        int safeLimit = Math.min(Math.max(limit, 1), 50);
        List<Medicine> hits = new ArrayList<>(medicineRepository.quickSearch(trimmed, PageRequest.of(0, safeLimit)));
        if (hits.size() < safeLimit) {
            Set<String> seen = hits.stream().map(Medicine::getId).collect(Collectors.toSet());
            for (Medicine m : medicineRepository.fuzzySearch(trimmed, safeLimit)) {
                if (hits.size() >= safeLimit) break;
                if (seen.add(m.getId())) hits.add(m);
            }
        }
        Map<String, PharmacyMedicineOverride> overrides = overridesByMedicineId(hits.stream().map(Medicine::getId).toList());
        List<MedicineResponse> results = new ArrayList<>(
                hits.stream().map(m -> toResponse(m, overrides.get(m.getId()))).toList());

        if (includeLocal && results.size() < safeLimit) {
            int remaining = safeLimit - results.size();
            for (PharmacyMedicine lm : pharmacyMedicineRepository.findByPharmacyIdAndNameContainingIgnoreCaseAndMatchStatusNot(
                    TenantContext.pharmacyId(), trimmed, com.checkup.pharmacy.common.enums.MedicineMatchStatus.LINKED,
                    PageRequest.of(0, remaining))) {
                results.add(toLocalResponse(lm));
            }
        }
        return results;
    }

    /** Exact barcode lookup — returns any status (active or not) so the caller can surface a
     *  specific "discontinued" message rather than a misleading "not found". */
    @Transactional(readOnly = true)
    public MedicineResponse findByBarcode(String barcode) {
        Medicine m = medicineRepository.findByBarcode(barcode)
                .orElseThrow(() -> new NotFoundException("No medicine is linked to barcode \"" + barcode + "\""));
        return toResponse(m, overridesByMedicineId(List.of(m.getId())).get(m.getId()));
    }

    /** This pharmacy's overrides for the given medicines, keyed by medicineId. Empty outside a tenant context. */
    private Map<String, PharmacyMedicineOverride> overridesByMedicineId(List<String> medicineIds) {
        if (medicineIds.isEmpty()) {
            return Map.of();
        }
        Map<String, PharmacyMedicineOverride> byId = new HashMap<>();
        for (PharmacyMedicineOverride o : overrideRepository
                .findByIdPharmacyIdAndIdMedicineIdIn(TenantContext.pharmacyId(), medicineIds)) {
            byId.put(o.getMedicineId(), o);
        }
        return byId;
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
        java.util.Map<String, PharmacyMedicineOverride> overridesById = new java.util.HashMap<>();
        for (PharmacyMedicineOverride o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medicineIds)) {
            overridesById.put(o.getMedicineId(), o);
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
                            b.getQuantity(), b.getLooseUnits(), b.getReservedQuantity(), b.getMrp(), b.getPurchaseRate(),
                            b.getLocation()))
                    .toList();

            PharmacyMedicineOverride ov = overridesById.get(med.getId());
            Integer effUpp = ov != null && ov.getUnitsPerPack() != null ? ov.getUnitsPerPack() : med.getUnitsPerPack();
            boolean allowLoose = ov != null && ov.isAllowLooseSale() && effUpp != null && effUpp > 1;
            boolean looseDefault = allowLoose && ov.isLooseByDefault();

            result.add(new AlternativeResponse(med.getId(), med.getName(), med.getManufacturer(), med.getGenericName(),
                    med.getStrength(), med.getForm(), med.getPackSize(), med.getHsnCode(),
                    overrideGst.getOrDefault(med.getId(), med.getGstRate()), med.getSchedule(),
                    null, totalStock, mrp, margin, stockStatus, effUpp,
                    com.checkup.pharmacy.common.util.BaseUnits.resolve(med.getBaseUnit(), med.getForm()),
                    allowLoose, looseDefault, batchDtos));
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
        com.checkup.pharmacy.common.tax.GstRates.requireAllowed(rate);
        return rate;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private MedicineResponse toResponse(Medicine m) {
        return toResponse(m, (PharmacyMedicineOverride) null);
    }

    /**
     * {@code override} is this pharmacy's row for the medicine (or null). Only the
     * POS-facing callers resolve it; the catalogue views pass null and get
     * {@code allowLooseSale = false} with the catalogue's own pack size.
     */
    private MedicineResponse toResponse(Medicine m, PharmacyMedicineOverride override) {
        boolean allowLoose = override != null && override.isAllowLooseSale();
        boolean looseDefault = allowLoose && override.isLooseByDefault();
        Integer effectiveUpp = override != null && override.getUnitsPerPack() != null
                ? override.getUnitsPerPack() : m.getUnitsPerPack();
        return new MedicineResponse(
                m.getId(), m.getName(), m.getGenericName(), m.getManufacturer(), m.getComposition(),
                m.getCategory(), m.getSchedule(), m.getHsnCode(), m.getGstRate(), m.getForm(),
                m.getStrength(), m.getUnit(), m.getPackSize(), m.isActive(),
                effectiveUpp, com.checkup.pharmacy.common.util.BaseUnits.resolve(m.getBaseUnit(), m.getForm()),
                allowLoose, looseDefault, false);
    }

    /**
     * A pharmacy-local medicine (see {@link PharmacyMedicine}) shaped as a search
     * result — {@code id} is a {@code PharmacyMedicine} id, not a global catalogue
     * one; callers must check {@code isLocal} before treating it as one. No loose-sale
     * support yet (always inactive-for-that-purpose), no composition/category/packSize
     * on record.
     */
    private MedicineResponse toLocalResponse(PharmacyMedicine m) {
        return new MedicineResponse(
                m.getId(), m.getName(), m.getGenericName(), m.getManufacturer(), null,
                null, m.getSchedule(), m.getHsnCode(), m.getGstRate(), m.getForm(),
                m.getStrength(), m.getUnit(), null, true,
                null, null, false, false, true);
    }

    private OverrideResponse toOverrideResponse(PharmacyMedicineOverride o, Integer catalogueUnitsPerPack) {
        Integer effective = o.getUnitsPerPack() != null ? o.getUnitsPerPack() : catalogueUnitsPerPack;
        return new OverrideResponse(o.getMedicineId(), o.getGstRate(), o.getDefaultDiscountPct(), o.getNotes(),
                o.isAllowLooseSale(), o.isLooseByDefault(), o.getLooseConfirmedAt(), o.getUnitsPerPack(), effective);
    }
}
