package com.checkup.pharmacy.modules.location;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.location.dto.CreateRackRequest;
import com.checkup.pharmacy.modules.location.dto.CreateShelfRequest;
import com.checkup.pharmacy.modules.location.dto.ListEnvelope;
import com.checkup.pharmacy.modules.location.dto.RackResponse;
import com.checkup.pharmacy.modules.location.dto.ShelfResponse;
import com.checkup.pharmacy.modules.location.dto.UpdateRackRequest;
import com.checkup.pharmacy.modules.location.dto.UpdateShelfRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Rack/shelf locations under /api/v1/locations — tenant-scoped, open to any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/locations")
public class LocationController {

    private final LocationService locationService;

    public LocationController(LocationService locationService) {
        this.locationService = locationService;
    }

    @GetMapping("/racks")
    public ApiResponse<ListEnvelope<RackResponse>> listRacks(
            @RequestParam(defaultValue = "false") boolean includeInactive,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResponse.ok(locationService.listRacks(includeInactive, page, limit));
    }

    @PostMapping("/racks")
    public ResponseEntity<ApiResponse<RackResponse>> createRack(@Valid @RequestBody CreateRackRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(locationService.createRack(req)));
    }

    @PatchMapping("/racks/{id}")
    public ApiResponse<RackResponse> updateRack(@PathVariable String id, @Valid @RequestBody UpdateRackRequest req) {
        return ApiResponse.ok(locationService.updateRack(id, req));
    }

    @GetMapping("/shelves")
    public ApiResponse<ListEnvelope<ShelfResponse>> listShelves(
            @RequestParam(defaultValue = "false") boolean includeInactive,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResponse.ok(locationService.listShelves(includeInactive, page, limit));
    }

    @PostMapping("/shelves")
    public ResponseEntity<ApiResponse<ShelfResponse>> createShelf(@Valid @RequestBody CreateShelfRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(locationService.createShelf(req)));
    }

    @PatchMapping("/shelves/{id}")
    public ApiResponse<ShelfResponse> updateShelf(@PathVariable String id, @Valid @RequestBody UpdateShelfRequest req) {
        return ApiResponse.ok(locationService.updateShelf(id, req));
    }
}
