package com.checkup.pharmacy.common.exception;

import org.springframework.http.HttpStatus;

/**
 * A dependency this operation needs is unavailable or unconfigured — the request
 * was valid and may well succeed once the environment is fixed.
 *
 * <p>Distinct from the generic 500 on purpose. The catch-all deliberately returns
 * the fixed string "Internal server error" so internals never leak, and the web
 * client rewrites that to "Something went wrong on our end." Correct for an
 * unexpected fault, useless for a missing environment variable: whoever is setting
 * the pharmacy up needs to be told which one. This status carries its message
 * through to the screen instead.
 */
public class ServiceUnavailableException extends AppException {

    public ServiceUnavailableException(String message) {
        super(HttpStatus.SERVICE_UNAVAILABLE, message);
    }
}
