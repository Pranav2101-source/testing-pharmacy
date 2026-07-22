package com.checkup.pharmacy.modules.auth.dto;

/** Login shape: { tokens: { accessToken }, user }. */
public record LoginResponse(AccessTokenResponse tokens, AuthUser user) {
}
