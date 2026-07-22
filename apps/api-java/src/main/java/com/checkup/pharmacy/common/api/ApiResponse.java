package com.checkup.pharmacy.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The universal response envelope. Every endpoint the React frontend calls
 * expects exactly this shape from the API:
 *   success path -> { "success": true,  "data": <T> }
 *   error path   -> { "success": false, "error": "<message>" }
 *
 * This is the single source of truth for the wire contract — any drift here
 * silently breaks the frontend. Null fields are omitted so a success response
 * never carries an "error" key and vice-versa.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(Boolean success, T data, String error) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }

    public static <T> ApiResponse<T> fail(String message) {
        return new ApiResponse<>(false, null, message);
    }
}
