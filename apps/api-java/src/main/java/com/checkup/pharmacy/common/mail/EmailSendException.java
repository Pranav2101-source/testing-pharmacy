package com.checkup.pharmacy.common.mail;

/**
 * A send was attempted and the provider rejected it. Deliberately not an
 * {@link com.checkup.pharmacy.common.exception.AppException} — mail failures are an
 * infrastructure problem, not a client error, so they must not be mapped to a 4xx and
 * handed back to whoever made the request.
 */
public class EmailSendException extends RuntimeException {

    public EmailSendException(String message) {
        super(message);
    }

    public EmailSendException(String message, Throwable cause) {
        super(message, cause);
    }
}
