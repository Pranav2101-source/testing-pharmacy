package com.checkup.pharmacy.common.exception;

import com.checkup.pharmacy.common.api.ApiResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;

import java.util.stream.Collectors;

/**
 * Translates every exception into the shared {@link ApiResponse} error envelope
 * with the correct HTTP status, so the frontend always receives a consistent
 * error shape — and so a user hitting an unexpected error sees a clear reason
 * instead of a generic failure whenever one is available.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Any expected, client-facing error carries its own status. */
    @ExceptionHandler(AppException.class)
    public ResponseEntity<ApiResponse<Void>> handleApp(AppException ex) {
        return ResponseEntity.status(ex.getStatus()).body(ApiResponse.fail(ex.getMessage()));
    }

    /** Bean Validation failures — the equivalent of a Zod parse error (400). */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(GlobalExceptionHandler::formatFieldError)
                .collect(Collectors.joining(", "));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(message.isBlank() ? "Validation failed" : message));
    }

    /**
     * @PreAuthorize denials. Method-security AOP throws this INSIDE the controller
     * invocation, so Spring MVC's exception resolution (this @RestControllerAdvice)
     * sees it before it can reach SecurityConfig's accessDeniedHandler — without this
     * handler it falls through to the generic 500 below instead of a 403.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.fail("Forbidden"));
    }

    /** Malformed JSON or an invalid enum value (e.g. bad `role` string) — 400, not 500. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnreadable(HttpMessageNotReadableException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail("Malformed request body"));
    }

    /** A required @RequestParam (e.g. multipart "file") was left out entirely — 400, not 500. */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingParam(MissingServletRequestParameterException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(ex.getParameterName() + " is required"));
    }

    /**
     * A query/path param couldn't be converted to the handler's type — e.g. {@code ?page=abc}
     * for an {@code int}, or a non-boolean {@code ?sortDesc=maybe}. Spring throws this while
     * binding arguments, before the controller runs, so without this handler it falls through
     * to the generic 500 — turning ordinary bad input into what looks like a server bug. Give
     * the caller the offending parameter and value instead.
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Void>> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        String expected = ex.getRequiredType() == null ? "a valid value"
                : "a valid " + ex.getRequiredType().getSimpleName().toLowerCase();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail("Invalid value '" + ex.getValue() + "' for parameter '"
                        + ex.getName() + "' — expected " + expected));
    }

    /**
     * A multipart upload exceeded spring.servlet.multipart.max-file-size/max-request-size —
     * thrown by Spring's multipart resolver before the controller (and UploadService's own
     * size check) ever runs, so without this handler it falls through to the generic 500 below.
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleUploadTooLarge(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail("File too large — maximum 10MB"));
    }

    /**
     * A multipart endpoint (@RequestParam MultipartFile) was called with a non-multipart body
     * (no file part at all) — Spring throws this resolving the missing argument, before the
     * controller ever runs. MaxUploadSizeExceededException is a subclass and is matched first
     * by Spring's most-specific-handler resolution, so this only catches the "no file" case.
     */
    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<ApiResponse<Void>> handleMultipart(MultipartException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail("No file provided"));
    }

    /**
     * The wrong HTTP verb for a real route — e.g. POST to a GET-only endpoint.
     *
     * <p>Spring's own DefaultHandlerExceptionResolver knows this is a 405, but it runs
     * AFTER this @RestControllerAdvice. Without an explicit handler the catch-all
     * below claims it first and reports "Internal server error", which sends whoever
     * is debugging a client to look for a server fault that does not exist.
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        String supported = ex.getSupportedHttpMethods() == null ? "" : ex.getSupportedHttpMethods().stream()
                .map(Object::toString).collect(Collectors.joining(", "));
        String message = supported.isBlank()
                ? ex.getMethod() + " is not supported for this endpoint"
                : ex.getMethod() + " is not supported for this endpoint — use " + supported;
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(ApiResponse.fail(message));
    }

    /**
     * A body sent with an unsupported Content-Type — typically a client that forgot
     * {@code Content-Type: application/json}. Same resolver-ordering trap as the 405
     * above: without this it surfaces as a 500.
     */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMediaTypeNotSupported(HttpMediaTypeNotSupportedException ex) {
        String supported = ex.getSupportedMediaTypes().isEmpty() ? "application/json"
                : ex.getSupportedMediaTypes().stream().map(Object::toString).collect(Collectors.joining(", "));
        String actual = ex.getContentType() == null ? "none" : ex.getContentType().toString();
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(ApiResponse.fail("Content-Type '" + actual + "' is not supported — send " + supported));
    }

    /**
     * A unique/foreign-key constraint fired at the database. Every module already
     * pre-checks uniqueness before insert (e.g. duplicate email, duplicate rack
     * code), but that check-then-insert has an inherent race window — two
     * concurrent requests can both pass the check and both hit the DB. Without
     * this handler that race surfaces as an opaque 500; with it, the caller gets
     * the same clear 409 they'd have gotten without the race.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataIntegrityViolation(DataIntegrityViolationException ex) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.fail("This record conflicts with existing data — it may already exist"));
    }

    /**
     * Last-resort catch-all: never leak stack traces or internals to the client,
     * but DO log the full exception server-side — otherwise a genuine bug is
     * invisible to everyone except whoever happens to be tailing the console.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail("Internal server error"));
    }

    private static String formatFieldError(FieldError fe) {
        return fe.getField() + ": " + fe.getDefaultMessage();
    }
}
