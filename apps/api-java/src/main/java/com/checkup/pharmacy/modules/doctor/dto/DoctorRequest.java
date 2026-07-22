package com.checkup.pharmacy.modules.doctor.dto;

import jakarta.validation.constraints.NotBlank;

/** Shared shape for POST and PATCH /doctors — the frontend submits the full form on both. */
public record DoctorRequest(
        @NotBlank(message = "Name is required") String name,
        String registrationNo,
        String specialty,
        String clinic,
        String phone,
        String email,
        String address
) {
}
