package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 401 — the caller is not authenticated (missing/invalid/expired token). */
public class UnauthorizedException extends AppException {
    public UnauthorizedException(String message) {
        super(HttpStatus.UNAUTHORIZED, message);
    }
}
