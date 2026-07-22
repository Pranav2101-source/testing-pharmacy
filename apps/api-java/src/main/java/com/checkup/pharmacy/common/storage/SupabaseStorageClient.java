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

    public SupabaseStorageClient(@Value("${supabase.url}") String baseUrl,
                                 @Value("${supabase.service-role-key}") String serviceRoleKey,
                                 @Value("${supabase.storage-bucket}") String bucket) {
        this.bucket = bucket;
        this.storageBaseUrl = baseUrl + "/storage/v1";
        this.restClient = RestClient.builder()
                .baseUrl(storageBaseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + serviceRoleKey)
                .defaultHeader("apikey", serviceRoleKey)
                .build();
    }

    /** Uploads bytes to {@code {bucket}/{path}}, overwriting if the path already exists. */
    public void upload(String path, byte[] bytes, String contentType) {
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
        return restClient.get()
                .uri("/object/" + bucket + "/" + path)
                .retrieve()
                .body(byte[].class);
    }

    /** A short-lived signed URL for viewing/downloading a previously uploaded object. */
    public String createSignedUrl(String path, int expiresInSeconds) {
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
