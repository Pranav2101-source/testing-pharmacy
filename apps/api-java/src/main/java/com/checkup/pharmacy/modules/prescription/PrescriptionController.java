package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.prescription.dto.ConfirmPrescriptionItemQuantityRequest;
import com.checkup.pharmacy.modules.prescription.dto.CreatePrescriptionRequest;
import com.checkup.pharmacy.modules.prescription.dto.NewPrescriptionCountResponse;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionPageResponse;
import com.checkup.pharmacy.modules.prescription.dto.LinkPrescriptionItemRequest;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionResponse;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionStockResponse;
import com.checkup.pharmacy.modules.prescription.dto.UpdatePrescriptionRequest;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/** Prescriptions under /api/v1/prescriptions — tenant-scoped, open to any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/prescriptions")
public class PrescriptionController {

    private final PrescriptionService prescriptionService;

    public PrescriptionController(PrescriptionService prescriptionService) {
        this.prescriptionService = prescriptionService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<PrescriptionResponse>> create(@Valid @RequestBody CreatePrescriptionRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(prescriptionService.create(req)));
    }

    @GetMapping
    public ApiResponse<PrescriptionPageResponse> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String doctorId,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.ok(prescriptionService.list(status, doctorId, search, from, to, page, limit));
    }

    /** Nav badge — a literal segment, matched ahead of "/{id}" by Spring's own specificity rules. */
    @GetMapping("/new-count")
    public ApiResponse<NewPrescriptionCountResponse> newCount() {
        return ApiResponse.ok(prescriptionService.newCount());
    }

    @GetMapping("/{id}")
    public ApiResponse<PrescriptionResponse> getById(@PathVariable String id) {
        return ApiResponse.ok(prescriptionService.getById(id));
    }

    /** Live stock per catalogue-linked line — powers the triage screen's stock-check step. */
    @GetMapping("/{id}/stock")
    public ApiResponse<PrescriptionStockResponse> stock(@PathVariable String id) {
        return ApiResponse.ok(prescriptionService.stockCheck(id));
    }

    /**
     * Brings measured lines back in step with the catalogue, for the lines where that is safe —
     * ACTIVE prescription, nothing dispensed, EMR-sourced, and the classification actually
     * changed. Idempotent, so the triage screen can call it on every open.
     *
     * <p>A PATCH rather than part of {@code /stock}: this writes, and the stock endpoint is
     * polled every 20 seconds by an open triage screen.
     */
    @PatchMapping("/{id}/re-resolve")
    public ApiResponse<PrescriptionResponse> reResolve(@PathVariable String id) {
        return ApiResponse.ok(prescriptionService.reResolveStaleMeasuredLines(id));
    }

    /** Fired when a pharmacist opens a row — clears it from the nav badge's count. */
    @PatchMapping("/{id}/viewed")
    public ResponseEntity<Void> markViewed(@PathVariable String id) {
        prescriptionService.markViewed(id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}")
    public ApiResponse<PrescriptionResponse> update(@PathVariable String id, @Valid @RequestBody UpdatePrescriptionRequest req) {
        return ApiResponse.ok(prescriptionService.update(id, req));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<PrescriptionResponse> cancel(@PathVariable String id) {
        return ApiResponse.ok(prescriptionService.cancel(id));
    }

    /**
     * Links a line the EMR sent to a product in this pharmacy's catalogue.
     *
     * <p>Until this is done the line cannot be attributed to anything sold, so the
     * prescription can never close and the clinic is never told it was fulfilled.
     */
    @PatchMapping("/{id}/items/{itemId}/medicine")
    public ApiResponse<PrescriptionResponse> linkItemMedicine(@PathVariable String id,
                                                              @PathVariable String itemId,
                                                              @Valid @RequestBody LinkPrescriptionItemRequest req) {
        return ApiResponse.ok(prescriptionService.linkItemToMedicine(id, itemId, req.medicineId()));
    }

    /**
     * Settles the real quantity for a line the clinic sent without one — see
     * {@link com.checkup.pharmacy.modules.prescription.PrescriptionItem#needsQuantityConfirmation()}.
     * Same shape as {@link #linkItemMedicine}: a human resolves what a machine feed left
     * ambiguous, and until it is resolved the line cannot be sold or reported back.
     */
    @PatchMapping("/{id}/items/{itemId}/quantity")
    public ApiResponse<PrescriptionResponse> confirmItemQuantity(@PathVariable String id,
                                                                  @PathVariable String itemId,
                                                                  @Valid @RequestBody ConfirmPrescriptionItemQuantityRequest req) {
        return ApiResponse.ok(prescriptionService.confirmItemQuantity(id, itemId, req.quantity()));
    }

    /**
     * Queues another attempt at telling the clinic what was dispensed.
     *
     * <p>POST rather than PATCH: this asks for an action to happen, and is deliberately not
     * idempotent in the sense that matters here — each call resets the retry budget.
     */
    @PostMapping("/{id}/dispense-notify/retry")
    public ApiResponse<PrescriptionResponse> retryDispenseNotify(@PathVariable String id) {
        return ApiResponse.ok(prescriptionService.retryDispenseNotify(id));
    }

    /** Queues another attempt at telling the clinic this prescription was cancelled. */
    @PostMapping("/{id}/cancel-notify/retry")
    public ApiResponse<PrescriptionResponse> retryCancelNotify(@PathVariable String id) {
        return ApiResponse.ok(prescriptionService.retryCancelNotify(id));
    }
}
