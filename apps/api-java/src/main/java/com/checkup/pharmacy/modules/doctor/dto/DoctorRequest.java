package com.checkup.pharmacy.modules.doctor.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.ProfessionalName;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** Shared shape for POST and PATCH /doctors — the frontend submits the full form on both. */
public record DoctorRequest(
        @NotBlank(message = "Name is required") @ProfessionalName String name,
        String registrationNo,
        String specialty,
        String clinic,
        @IndianMobile String phone,
        @Email(message = "Enter a valid email address") String email,
        String address
) {
}
