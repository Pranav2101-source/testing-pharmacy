package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/**
 * Base type for all expected, client-facing application errors. Carries the
 * HTTP status so {@link GlobalExceptionHandler} can translate it into the
 * correct response code and {@link com.checkup.pharmacy.common.api.ApiResponse}
 * envelope.
 *
 * Abstract on purpose: throw one of the concrete subclasses
 * ({@link NotFoundException}, {@link BadRequestException}, …) so the intended
 * status is always explicit at the throw site.
 */
public abstract class AppException extends RuntimeException {

    private final HttpStatus status;

    protected AppException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
