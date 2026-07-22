package com.checkup.pharmacy.modules.auth.dto;

/** { accessToken } — used directly by /refresh and nested under login's `tokens`. */
public record AccessTokenResponse(String accessToken) {
}
