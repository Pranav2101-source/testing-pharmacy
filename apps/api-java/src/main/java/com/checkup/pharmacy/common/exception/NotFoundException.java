package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 404 — the requested resource does not exist (or is not visible to this tenant). */
public class NotFoundException extends AppException {
    public NotFoundException(String message) {
        super(HttpStatus.NOT_FOUND, message);
    }
}
