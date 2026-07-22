package com.checkup.pharmacy.modules.doctor.dto;

import java.util.List;

/**
 * GET /doctors returns { success, data: Doctor[], total, pages } — total/pages
 * are SIBLINGS of data, not nested inside it (unlike the {@code items/total/
 * totalPages} shape used by medicines/customers). Returned directly by the
 * controller rather than wrapped in the shared ApiResponse envelope, since it
 * already carries its own {@code success} field matching that exact contract.
 */
public record DoctorListResponse(boolean success, List<DoctorResponse> data, long total, int pages) {

    public static DoctorListResponse of(List<DoctorResponse> data, long total, int pages) {
        return new DoctorListResponse(true, data, total, pages);
    }
}
