package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import com.checkup.pharmacy.modules.medicine.dto.AlternativeResponse;
import com.checkup.pharmacy.modules.medicine.dto.BulkImportRequest;
import com.checkup.pharmacy.modules.medicine.dto.BulkImportResponse;
import com.checkup.pharmacy.modules.medicine.dto.CreateMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.LoosePosSettingsRequest;
import com.checkup.pharmacy.modules.medicine.dto.MedicinePageResponse;
import com.checkup.pharmacy.modules.medicine.dto.MedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.OverrideResponse;
import com.checkup.pharmacy.modules.medicine.dto.ReindexResponse;
import com.checkup.pharmacy.modules.medicine.dto.SetBarcodeRequest;
import com.checkup.pharmacy.modules.medicine.dto.SetClassificationRequest;
import com.checkup.pharmacy.modules.medicine.dto.UpdateMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.UpsertOverrideRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The shared medicine catalog under /api/v1/medicines. Reads, single-record
 * create, and bulk import are open to any authenticated user; edits and
 * activation state are PLATFORM_ADMIN-only since the catalog is shared across
 * every tenant. Override endpoints manage the caller's own pharmacy-level
 * customization and are open to any authenticated user, matching the frontend
 * (no owner/admin gate on that action today).
 */
@RestController
@RequestMapping("/api/v1/medicines")
public class MedicineController {

    private final MedicineService medicineService;

    public MedicineController(MedicineService medicineService) {
        this.medicineService = medicineService;
    }

    @GetMapping
    public ApiResponse<MedicinePageResponse> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String schedule,
            @RequestParam(required = false) String form,
            @RequestParam(required = false) Boolean isActive,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(medicineService.list(search, schedule, form, isActive, page, limit));
    }

    /**
     * Adds a new catalog entry — OWNER/MANAGER only. Intentionally not PLATFORM_ADMIN-gated
     * like {@link #update}/{@link #deactivate}: the catalog is meant to grow as pharmacies
     * encounter a medicine it's missing, so this stays a write pharmacy staff can make, just
     * not CASHIER/PHARMACIST — creating a new shared row is a different trust level than
     * billing or receiving stock.
     */
    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ResponseEntity<ApiResponse<MedicineResponse>> create(@Valid @RequestBody CreateMedicineRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(medicineService.create(req)));
    }

    /**
     * Quick fuzzy search for the billing/GRN combobox — {@code GET /medicines?...} covers the
     * full catalog page. {@code includeLocal} additionally merges this pharmacy's own
     * not-yet-catalogued medicines (see {@link PharmacyMedicine}) — only the billing combobox
     * passes it; every other caller (Add Stock, barcode mapping, alternatives) writes against
     * a global medicineId and must keep seeing catalogue-only results.
     */
    @GetMapping("/search")
    public ApiResponse<List<MedicineResponse>> search(
            @RequestParam String q, @RequestParam(defaultValue = "8") int limit,
            @RequestParam(defaultValue = "false") boolean includeLocal) {
        return ApiResponse.ok(medicineService.quickSearch(q, limit, includeLocal));
    }

    /**
     * One medicine with this pharmacy's pack size and loose setting resolved. Declared after
     * the literal GET paths above for readability only — Spring ranks literal segments over
     * a template, so {@code /search} and {@code /overrides} are never captured as an id.
     */
    @GetMapping("/{id}")
    public ApiResponse<MedicineResponse> get(@PathVariable String id) {
        return ApiResponse.ok(medicineService.get(id));
    }

    @GetMapping("/barcode/{code}")
    public ApiResponse<MedicineResponse> findByBarcode(@PathVariable String code) {
        return ApiResponse.ok(medicineService.findByBarcode(code));
    }

    /** Links a barcode to a medicine — open to any staff (routine POS/receiving task), not PLATFORM_ADMIN-gated. */
    @PatchMapping("/{id}/barcode")
    public ApiResponse<MedicineResponse> setBarcode(@PathVariable String id, @Valid @RequestBody SetBarcodeRequest req) {
        return ApiResponse.ok(medicineService.setBarcode(id, req.barcode()));
    }

    /**
     * Sets a medicine's category + packaging (free-text) — OWNER/MANAGER only, a narrow
     * catalog enrichment done from the inventory/POS flow (not the PLATFORM_ADMIN-gated full edit).
     */
    @PatchMapping("/{id}/classification")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<MedicineResponse> setClassification(@PathVariable String id,
                                                           @Valid @RequestBody SetClassificationRequest req) {
        return ApiResponse.ok(medicineService.setClassification(id, req.category(), req.unit()));
    }

    /** Generic-substitution alternatives with the caller pharmacy's live stock — powers the billing drawer. */
    @GetMapping("/{id}/alternatives")
    public ApiResponse<List<AlternativeResponse>> alternatives(@PathVariable String id) {
        return ApiResponse.ok(medicineService.getAlternatives(id, TenantContext.pharmacyId()));
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<MedicineResponse> update(
            @PathVariable String id, @Valid @RequestBody UpdateMedicineRequest req) {
        return ApiResponse.ok(medicineService.update(id, req));
    }

    /** Soft-delete: deactivates the catalog entry. Never hard-deleted. */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<MedicineResponse> deactivate(@PathVariable String id) {
        return ApiResponse.ok(medicineService.deactivate(id));
    }

    @PatchMapping("/{id}/activate")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<MedicineResponse> activate(@PathVariable String id) {
        return ApiResponse.ok(medicineService.activate(id));
    }

    /** Same trust level as {@link #create} — one write vs. many, not a different rule. */
    @PostMapping("/bulk")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<BulkImportResponse> bulkImport(@Valid @RequestBody BulkImportRequest req) {
        return ApiResponse.ok(medicineService.bulkImport(req));
    }

    @PostMapping("/reindex")
    @PreAuthorize("hasRole('PLATFORM_ADMIN')")
    public ApiResponse<ReindexResponse> reindex() {
        return ApiResponse.ok(medicineService.reindex());
    }

    @GetMapping("/overrides")
    public ApiResponse<List<OverrideResponse>> listMyOverrides() {
        return ApiResponse.ok(medicineService.listMyOverrides());
    }

    @PutMapping("/{id}/override")
    public ApiResponse<OverrideResponse> upsertOverride(
            @PathVariable String id, @Valid @RequestBody UpsertOverrideRequest req) {
        return ApiResponse.ok(medicineService.upsertOverride(id, req));
    }

    @DeleteMapping("/{id}/override")
    public ApiResponse<Void> removeOverride(@PathVariable String id) {
        medicineService.removeOverride(id);
        return ApiResponse.ok(null);
    }

    /**
     * Turn cut-strip (loose) selling on/off for one medicine at the caller's pharmacy.
     * OWNER/MANAGER only — enabling it changes how the medicine is priced at the POS.
     */
    @PatchMapping("/{id}/loose-settings")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<OverrideResponse> setLooseSettings(
            @PathVariable String id, @Valid @RequestBody LoosePosSettingsRequest req) {
        return ApiResponse.ok(medicineService.setLoosePosSettings(id, req));
    }

    /** Enable loose selling for several medicines at once. OWNER/MANAGER only. */
    @PostMapping("/loose-settings/bulk")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<List<OverrideResponse>> bulkEnableLoose(
            @Valid @RequestBody com.checkup.pharmacy.modules.medicine.dto.BulkEnableLooseRequest req) {
        return ApiResponse.ok(medicineService.bulkEnableLoose(req.items().stream()
                .map(r -> new MedicineService.BulkLooseRow(r.medicineId(), r.unitsPerPack(), r.looseByDefault()))
                .toList()));
    }
}
