package com.checkup.pharmacy.common.exception;

import com.checkup.pharmacy.common.api.ApiResponse;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies what the CLIENT actually receives when something goes wrong — status code
 * and the {@link ApiResponse} error envelope — rather than what the handler methods
 * return in isolation.
 *
 * <p>That distinction matters here. Several of these exceptions are thrown by Spring
 * during argument binding or handler lookup, BEFORE any controller runs, and whether
 * they reach a given @ExceptionHandler depends on resolver ordering that only a real
 * dispatch reproduces. Calling the handler methods directly would assert nothing
 * about production behaviour.
 */
class GlobalExceptionHandlerTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Nested
    @DisplayName("application errors carry their own status and a usable message")
    class ApplicationErrors {

        @Test
        void notFoundBecomes404WithItsMessage() throws Exception {
            mockMvc.perform(get("/probe/not-found"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.success").value(false))
                    .andExpect(jsonPath("$.error").value("Invoice not found"));
        }

        @Test
        void conflictBecomes409WithItsMessage() throws Exception {
            mockMvc.perform(get("/probe/conflict"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.error").value("Invoice is already cancelled"));
        }

        @Test
        void accessDeniedBecomes403() throws Exception {
            mockMvc.perform(get("/probe/denied"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error").value("Forbidden"));
        }
    }

    @Nested
    @DisplayName("bad input is reported as the caller's fault, and says which field")
    class BadInput {

        @Test
        @DisplayName("a validation failure names the offending field")
        void validationFailureNamesField() throws Exception {
            mockMvc.perform(post("/probe/items")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"\",\"quantity\":5}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("name")));
        }

        @Test
        @DisplayName("a non-numeric value for an int parameter names the parameter and the value")
        void typeMismatchNamesParameterAndValue() throws Exception {
            mockMvc.perform(get("/probe/paged").param("page", "abc"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("page")))
                    .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("abc")));
        }

        @Test
        @DisplayName("a missing required parameter says which one")
        void missingParameterNamesIt() throws Exception {
            mockMvc.perform(get("/probe/paged"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("page")));
        }

        @Test
        @DisplayName("malformed JSON is a 400, not a 500")
        void malformedJsonIsBadRequest() throws Exception {
            mockMvc.perform(post("/probe/items")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{not json"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("Malformed request body"));
        }
    }

    /**
     * These are the cases a catch-all {@code @ExceptionHandler(Exception.class)}
     * silently absorbs.
     *
     * <p>Spring's own {@code DefaultHandlerExceptionResolver} knows how to turn each
     * of these into the right 4xx, but it runs AFTER the @ControllerAdvice resolver.
     * So whichever ones the advice does not name explicitly get reported to the user
     * as "Internal server error" — telling a pharmacist that the server is broken when
     * in fact the request was simply addressed wrong.
     */
    @Nested
    @DisplayName("client mistakes must not be reported as server failures")
    class ClientMistakesAreNot500s {

        @Test
        @DisplayName("POSTing to a GET-only route is 405 Method Not Allowed")
        void wrongMethodIs405() throws Exception {
            mockMvc.perform(post("/probe/not-found"))
                    .andExpect(status().isMethodNotAllowed());
        }

        @Test
        @DisplayName("an unsupported Content-Type is 415 Unsupported Media Type")
        void wrongContentTypeIs415() throws Exception {
            mockMvc.perform(post("/probe/items")
                            .contentType(MediaType.TEXT_PLAIN)
                            .content("name=x"))
                    .andExpect(status().isUnsupportedMediaType());
        }
    }

    @Nested
    @DisplayName("genuine server faults")
    class ServerFaults {

        @Test
        @DisplayName("an unexpected exception is a 500 that leaks no internal detail")
        void unexpectedExceptionLeaksNothing() throws Exception {
            mockMvc.perform(get("/probe/boom"))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.error").value("Internal server error"))
                    // The probe throws a message containing a fake secret; if the
                    // envelope ever echoes the exception message, this catches it.
                    .andExpect(jsonPath("$.error")
                            .value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("s3cr3t"))));
        }
    }

    // ── Probe controller ──────────────────────────────────────────────────────
    // A stand-in for a real controller so the test exercises the dispatch path
    // without dragging in security, JPA, or a database.

    record ProbeBody(@NotBlank String name, @Min(1) Integer quantity) {
    }

    @RestController
    static class ProbeController {

        @GetMapping("/probe/not-found")
        ApiResponse<String> notFound() {
            throw new NotFoundException("Invoice not found");
        }

        @GetMapping("/probe/conflict")
        ApiResponse<String> conflict() {
            throw new ConflictException("Invoice is already cancelled");
        }

        @GetMapping("/probe/denied")
        ApiResponse<String> denied() {
            throw new AccessDeniedException("nope");
        }

        @GetMapping("/probe/boom")
        ApiResponse<String> boom() {
            throw new IllegalStateException("connection failed for user admin password s3cr3t");
        }

        @GetMapping("/probe/paged")
        ApiResponse<String> paged(@RequestParam int page) {
            return ApiResponse.ok("page " + page);
        }

        @PostMapping(value = "/probe/items", consumes = MediaType.APPLICATION_JSON_VALUE)
        ApiResponse<String> create(@Valid @RequestBody ProbeBody body) {
            return ApiResponse.ok(body.name());
        }

        @GetMapping("/probe/items/{id}")
        ApiResponse<String> byId(@PathVariable String id) {
            return ApiResponse.ok(id);
        }
    }
}
