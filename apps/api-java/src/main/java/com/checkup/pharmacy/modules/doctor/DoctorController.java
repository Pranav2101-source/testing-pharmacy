package com.checkup.pharmacy.modules.doctor;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.doctor.dto.DoctorListResponse;
import com.checkup.pharmacy.modules.doctor.dto.DoctorRequest;
import com.checkup.pharmacy.modules.doctor.dto.DoctorResponse;
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

/** Doctor master under /api/v1/doctors — tenant-scoped, open to any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/doctors")
public class DoctorController {

    private final DoctorService doctorService;

    public DoctorController(DoctorService doctorService) {
        this.doctorService = doctorService;
    }

    @GetMapping
    public DoctorListResponse list(
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit) {
        return doctorService.list(search, page, limit);
    }

    @PostMapping
    public ResponseEntity<ApiResponse<DoctorResponse>> create(@Valid @RequestBody DoctorRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(doctorService.create(req)));
    }

    @PatchMapping("/{id}")
    public ApiResponse<DoctorResponse> update(@PathVariable String id, @Valid @RequestBody DoctorRequest req) {
        return ApiResponse.ok(doctorService.update(id, req));
    }

    @PatchMapping("/{id}/deactivate")
    public ApiResponse<DoctorResponse> deactivate(@PathVariable String id) {
        return ApiResponse.ok(doctorService.deactivate(id));
    }

    @PatchMapping("/{id}/reactivate")
    public ApiResponse<DoctorResponse> reactivate(@PathVariable String id) {
        return ApiResponse.ok(doctorService.reactivate(id));
    }
}
