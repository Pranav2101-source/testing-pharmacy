package com.checkup.pharmacy.security;

/** A freshly issued access + refresh token pair. */
public record TokenPair(String accessToken, String refreshToken) {
}
