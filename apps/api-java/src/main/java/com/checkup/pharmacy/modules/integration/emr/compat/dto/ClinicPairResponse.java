package com.checkup.pharmacy.modules.integration.emr.compat.dto;

/**
 * The credential a clinic receives once, at pairing.
 *
 * <p>Field names are a wire contract — see {@link ClinicPairRequest}.
 *
 * <p>{@code apiSecret} is the only time the plaintext exists outside the clinic's database:
 * the pharmacy stores a SHA-256 hash of it and cannot produce it again. A clinic that loses
 * it re-pairs; there is deliberately no recovery endpoint, because one would be a way to
 * read a live credential out of the system.
 */
public record ClinicPairResponse(
        String apiKey,
        String apiSecret,
        String pharmacyId,
        String pharmacyName,
        String clinicLinkId
) {
}
