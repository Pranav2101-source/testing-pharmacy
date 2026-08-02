package com.checkup.pharmacy.common.storage;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * Thin wrapper over Supabase Storage's REST API (no SDK exists for Java) — used to store
 * source PDFs (GRN/PO) and prescription scans. Calls are made with the service-role key,
 * which bypasses bucket RLS policies entirely; this class must never be reachable from
 * anything the frontend calls directly, only from server-side upload/signing flows.
 *
 * Storage paths are always built from server-generated identifiers (pharmacyId, a Cuid,
 * and a validated extension) — never from a raw user-supplied filename — so no URL-encoding
 * of the path is ever needed.
 */
@Component
public class SupabaseStorageClient {

    private final RestClient restClient;
    private final String storageBaseUrl;
    private final String bucket;
    private final boolean configured;

    public SupabaseStorageClient(@Value("${supabase.url}") String baseUrl,
                                 @Value("${supabase.service-role-key}") String serviceRoleKey,
                                 @Value("${supabase.storage-bucket}") String bucket) {
        this.bucket = bucket;
        // Both default to empty (see application.yml), so an environment that never
        // set them starts fine and then fails on the first upload with an opaque
        // connection error against the URL "/storage/v1". Recording it here lets the
        // guard below name the two variables instead.
        this.configured = baseUrl != null && !baseUrl.isBlank()
                && serviceRoleKey != null && !serviceRoleKey.isBlank();
        this.storageBaseUrl = baseUrl + "/storage/v1";
        this.restClient = RestClient.builder()
                .baseUrl(storageBaseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + serviceRoleKey)
                .defaultHeader("apikey", serviceRoleKey)
                .build();
    }

    /**
     * Fails with an actionable message when file storage was never configured.
     *
     * <p>Without this the first upload attempt dies inside RestClient against a
     * malformed base URL, and the settings screen reports a generic server error —
     * giving whoever is setting the pharmacy up no way to know that two environment
     * variables are simply missing.
     */
    private void requireConfigured() {
        if (!configured) {
            throw new com.checkup.pharmacy.common.exception.ServiceUnavailableException(
                    "File storage is not configured on the server — set SUPABASE_URL and "
                    + "SUPABASE_SERVICE_ROLE_KEY, then try again.");
        }
    }

    /** Uploads bytes to {@code {bucket}/{path}}, overwriting if the path already exists. */
    public void upload(String path, byte[] bytes, String contentType) {
        requireConfigured();
        restClient.post()
                .uri("/object/" + bucket + "/" + path)
                .header(HttpHeaders.CONTENT_TYPE, contentType)
                .header("x-upsert", "true")
                .body(bytes)
                .retrieve()
                .toBodilessEntity();
    }

    /** Downloads the raw bytes of a previously uploaded object — used to proxy a file back through our own API. */
    public byte[] download(String path) {
        requireConfigured();
        return restClient.get()
                .uri("/object/" + bucket + "/" + path)
                .retrieve()
                .body(byte[].class);
    }

    /** A short-lived signed URL for viewing/downloading a previously uploaded object. */
    public String createSignedUrl(String path, int expiresInSeconds) {
        requireConfigured();
        SignedUrlResponse resp = restClient.post()
                .uri("/object/sign/" + bucket + "/" + path)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("expiresIn", expiresInSeconds))
                .retrieve()
                .body(SignedUrlResponse.class);
        if (resp == null || resp.signedURL() == null) {
            throw new IllegalStateException("Supabase Storage did not return a signed URL for " + path);
        }
        return storageBaseUrl + resp.signedURL();
    }

    private record SignedUrlResponse(String signedURL) {
    }
}
