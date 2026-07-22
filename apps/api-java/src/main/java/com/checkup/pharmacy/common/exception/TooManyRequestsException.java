package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/** 429 — the caller has exceeded a rate limit (login attempts, registrations, etc.). */
public class TooManyRequestsException extends AppException {
    public TooManyRequestsException(String message) {
        super(HttpStatus.TOO_MANY_REQUESTS, message);
    }
}
