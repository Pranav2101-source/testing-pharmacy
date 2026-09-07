package com.checkup.pharmacy.modules.dispensing;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.enums.DispensingStrategy;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlan;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingPlanRequest;
import com.checkup.pharmacy.modules.dispensing.dto.DispensingStrategyResponse;
import com.checkup.pharmacy.modules.dispensing.dto.UpdateDispensingStrategyRequest;
import com.checkup.pharmacy.modules.inventory.InventoryService;
import com.checkup.pharmacy.modules.inventory.dto.InventoryResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The dispensing engine's HTTP surface, under {@code /api/v1/dispensing} —
 * tenant-scoped. Every dispensing UI (billing search, batch picker, Quick Add,
 * Repeat Last Bill, prescription fulfilment) reads batch order and allocation from
 * here rather than deciding client-side. See {@link DispensingService}.
 */
@RestController
@RequestMapping("/api/v1/dispensing")
public class DispensingController {

    private final DispensingService dispensingService;
    private final InventoryService inventoryService;

    public DispensingController(DispensingService dispensingService, InventoryService inventoryService) {
        this.dispensingService = dispensingService;
        this.inventoryService = inventoryService;
    }

    /** The pharmacy's current batch-selection strategy, plus the product default. */
    @GetMapping("/strategy")
    public ApiResponse<DispensingStrategyResponse> getStrategy() {
        return ApiResponse.ok(new DispensingStrategyResponse(
                dispensingService.currentStrategy().name(), DispensingStrategy.DEFAULT.name()));
    }

    /**
     * Changes the pharmacy-wide strategy. Owners and managers only — it is shop
     * policy. Affects only future dispensing; past bills keep their own snapshot.
     */
    @PutMapping("/strategy")
    @PreAuthorize("hasAnyRole('OWNER','MANAGER')")
    public ApiResponse<DispensingStrategyResponse> updateStrategy(
            @Valid @RequestBody UpdateDispensingStrategyRequest req) {
        DispensingStrategy next = dispensingService.updateStrategy(req.strategy());
        return ApiResponse.ok(new DispensingStrategyResponse(next.name(), DispensingStrategy.DEFAULT.name()));
    }

    /** Allocation plan for arbitrary medicine + required-piece lines. */
    @PostMapping("/plan")
    public ApiResponse<DispensingPlan> plan(@Valid @RequestBody DispensingPlanRequest req) {
        return ApiResponse.ok(dispensingService.plan(req.lines()));
    }

    /** Auto-dispensing plan for a whole prescription (EMR or counter). */
    @GetMapping("/prescriptions/{prescriptionId}/plan")
    public ApiResponse<DispensingPlan> prescriptionPlan(@PathVariable String prescriptionId) {
        return ApiResponse.ok(dispensingService.planForPrescription(prescriptionId));
    }

    /**
     * Every sellable batch of a medicine, in the configured dispensing order — the
     * authoritative list for the manual batch picker. Pass {@code medicineId} for a
     * catalogue medicine or {@code localMedicineId} for a pharmacy-local one.
     */
    @GetMapping("/batches")
    public ApiResponse<List<InventoryResponse>> batches(
            @RequestParam(required = false) String medicineId,
            @RequestParam(required = false) String localMedicineId) {
        return ApiResponse.ok(inventoryService.dispensingBatches(medicineId, localMedicineId));
    }
}
