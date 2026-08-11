package com.checkup.pharmacy.common.exception;

import com.checkup.pharmacy.common.api.ApiResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import org.springframework.http.HttpMethod;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The status a wrong URL reports.
 *
 * <p>This class's catch-all {@code @ExceptionHandler(Exception.class)} is a known trap:
 * {@code @RestControllerAdvice} resolves exceptions before Spring's own defaults can,
 * so anything not explicitly handled here is reported as a 500 no matter what it
 * actually is. {@code AccessDeniedException} fell into it once (403 reported as 500);
 * {@code NoResourceFoundException} was the second, and it made every mistyped path
 * look like a server outage.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    @DisplayName("an unknown path is a 404, not a 500")
    void unknownPathIsNotFound() {
        ResponseEntity<ApiResponse<Void>> res =
                handler.handleNoResource(new NoResourceFoundException(HttpMethod.GET, "api/v1/dues/summary"));

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(res.getBody()).isNotNull();
        assertThat(res.getBody().success()).isFalse();
    }

    @Test
    @DisplayName("the message names the path, so a client typo is self-diagnosing")
    void messageNamesThePath() {
        // "Internal server error" sent whoever was debugging looking for a broken
        // service; the path is what tells them the URL is simply wrong.
        ResponseEntity<ApiResponse<Void>> res =
                handler.handleNoResource(new NoResourceFoundException(HttpMethod.GET, "api/v1/cash-closure/today"));

        assertThat(res.getBody()).isNotNull();
        assertThat(res.getBody().error()).contains("api/v1/cash-closure/today");
    }

    @Test
    @DisplayName("a genuine unexpected exception still reports 500 and leaks nothing")
    void unexpectedStaysOpaque() {
        ResponseEntity<ApiResponse<Void>> res =
                handler.handleUnexpected(new IllegalStateException("connection pool exhausted at line 42"));

        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(res.getBody()).isNotNull();
        assertThat(res.getBody().error())
                .isEqualTo("Internal server error")
                .doesNotContain("connection pool");
    }
}
