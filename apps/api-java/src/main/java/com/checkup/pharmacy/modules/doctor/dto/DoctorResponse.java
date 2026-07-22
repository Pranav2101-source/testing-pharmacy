package com.checkup.pharmacy.modules.doctor.dto;

import java.time.Instant;

/** Matches the frontend's Doctor shape. */
public record DoctorResponse(
        String id,
        String pharmacyId,
        String name,
        String registrationNo,
        String specialty,
        String clinic,
        String phone,
        String email,
        String address,
        boolean isActive,
        Instant createdAt
) {
}
