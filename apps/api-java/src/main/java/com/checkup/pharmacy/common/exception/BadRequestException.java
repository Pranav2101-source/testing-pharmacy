package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 400 — the request was malformed or failed a business rule. */
public class BadRequestException extends AppException {
    public BadRequestException(String message) {
        super(HttpStatus.BAD_REQUEST, message);
    }
}
