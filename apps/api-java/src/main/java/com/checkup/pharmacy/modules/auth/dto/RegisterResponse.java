package com.checkup.pharmacy.modules.auth.dto;

/** Register shape: { accessToken, user } (note: flat accessToken, unlike login). */
public record RegisterResponse(String accessToken, AuthUser user) {
}
