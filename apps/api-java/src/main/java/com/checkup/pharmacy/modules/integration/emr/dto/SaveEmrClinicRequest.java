package com.checkup.pharmacy.modules.integration.emr.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The clinic details a pharmacist copies out of their clinic's integration screen. */
public record SaveEmrClinicRequest(
        @NotBlank @Size(max = 200) String clinicName,
        @NotBlank @Size(max = 500) String callbackUrl) {
}
