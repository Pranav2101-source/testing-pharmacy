package com.checkup.pharmacy.modules.integration.emr.compat.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * What a clinic presents to establish a link.
 *
 * <p><b>Field names are a wire contract</b>, not a naming preference: they must match what
 * the clinic's client already serialises, byte for byte. Renaming one to read better here
 * silently breaks pairing, and does so with a 400 that names a field the other team cannot
 * find in their code. Change these only alongside the other product.
 *
 * @param code         the pairing code, which is the key the pharmacist generated on their
 *                     own Integrations screen and read across to the clinic.
 * @param emrClinicId  the clinic's own id for itself; every later request identifies its
 *                     tenant this way.
 * @param clinicName   display name, shown to the pharmacist so they can confirm they linked
 *                     the practice they meant to.
 * @param emrBaseUrl   where to reach the clinic. The callback path is appended to this — the
 *                     pharmacist never has to be told a URL.
 * @param webhookSecret the secret the clinic will verify our dispensing callbacks with.
 */
public record ClinicPairRequest(
        @NotBlank(message = "Pairing code is required")
        String code,

        @NotBlank(message = "Clinic id is required")
        String emrClinicId,

        @NotBlank(message = "Clinic name is required")
        String clinicName,

        @NotBlank(message = "Clinic address is required")
        String emrBaseUrl,

        @NotBlank(message = "Webhook secret is required")
        String webhookSecret
) {
}
