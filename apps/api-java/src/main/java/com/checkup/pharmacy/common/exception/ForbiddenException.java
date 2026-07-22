package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 403 — the caller is authenticated but lacks permission for this action. */
public class ForbiddenException extends AppException {
    public ForbiddenException(String message) {
        super(HttpStatus.FORBIDDEN, message);
    }
}
