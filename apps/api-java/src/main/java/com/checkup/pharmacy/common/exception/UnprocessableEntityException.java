package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 422 — the request is well-formed but violates a business rule (e.g. insufficient stock). */
public class UnprocessableEntityException extends AppException {
    public UnprocessableEntityException(String message) {
        super(HttpStatus.UNPROCESSABLE_ENTITY, message);
    }
}
