package com.checkup.pharmacy.modules.medicine;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.medicine.dto.CreateLocalMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.LinkLocalMedicineRequest;
import com.checkup.pharmacy.modules.medicine.dto.LocalMedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.PendingLocalMedicineResponse;
import com.checkup.pharmacy.modules.medicine.dto.PharmacyMedicineResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Pharmacy-local medicines under /api/v1/purchases/local-medicines — the escape
 * hatch that lets a GRN receive a medicine not yet in the shared global catalog
 * without ever blocking on it. Same trust level as {@code POST /medicines}
 * (OWNER/MANAGER, not CASHIER/PHARMACIST): creating a new product identity is a
 * different trust level than billing or receiving stock, matching
 * {@link MedicineController#create}'s reasoning — the difference here is that
 * these writes are pharmacy-scoped, never the shared catalog.
 */
@RestController
@RequestMapping("/api/v1/purchases/local-medicines")
public class PharmacyMedicineController {

    private final PharmacyMedicineService service;

    public PharmacyMedicineController(PharmacyMedicineService service) {
        this.service = service;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ResponseEntity<ApiResponse<PharmacyMedicineResponse>> create(@Valid @RequestBody CreateLocalMedicineRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(service.create(req)));
    }

    /**
     * Local medicines the background matcher found a fuzzy candidate for — needs a human to
     * confirm. OWNER/MANAGER only, matching every other endpoint on this controller: the
     * corresponding review panel is already gated client-side, but a CASHIER/PHARMACIST hitting
     * this directly had no server-side check backing that.
     */
    @GetMapping("/pending")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<List<PendingLocalMedicineResponse>> pending() {
        return ApiResponse.ok(service.listPending());
    }

    /**
     * Every local medicine this pharmacy has, any status — the full directory, not just pending
     * review. OWNER/MANAGER only — see {@link #pending()}. Billing's own discovery of local
     * medicines (the combobox's {@code includeLocal} search) does not go through this controller,
     * so this gate has no effect on the POS.
     */
    @GetMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<List<LocalMedicineResponse>> list() {
        return ApiResponse.ok(service.listAll());
    }

    /** Confirms (or manually picks) the global catalogue link — additive, never rewrites past GRNs/sales. */
    @PatchMapping("/{id}/link")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<PharmacyMedicineResponse> link(@PathVariable String id, @Valid @RequestBody LinkLocalMedicineRequest req) {
        return ApiResponse.ok(service.confirmLink(id, req.medicineId()));
    }

    /** Undoes a link — a pharmacist confirmed the wrong global medicine. Never rewrites past GRNs/sales. */
    @PatchMapping("/{id}/unlink")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public ApiResponse<PharmacyMedicineResponse> unlink(@PathVariable String id) {
        return ApiResponse.ok(service.unlink(id));
    }
}
