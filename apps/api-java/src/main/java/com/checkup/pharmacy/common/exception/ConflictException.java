package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 409 — the request conflicts with current state (e.g. a uniqueness violation). */
public class ConflictException extends AppException {
    public ConflictException(String message) {
        super(HttpStatus.CONFLICT, message);
    }
}
