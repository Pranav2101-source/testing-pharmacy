package com.checkup.pharmacy.modules.upload.dto;

/**
 * Result of a successful upload.
 *
 * @param id        the Upload row's id — persist this; it is what
 *                  {@code GET /uploads/{id}/signed-url} needs to mint a fresh link later.
 * @param fileName  the original filename, for display.
 * @param fileUrl   the durable storage path. Persist this too: unlike {@code signedUrl}
 *                  it does not expire, so it is the reference that belongs in a saved
 *                  record. It was absent from this DTO while the settings screens
 *                  already read {@code fileUrl} off the response, so a document saved
 *                  from that screen stored {@code undefined} as its file path.
 * @param signedUrl short-lived (10 min) access URL — fine for showing the file the user
 *                  just uploaded, useless once stored.
 * @param mimeType  sniffed from the bytes, not the client's declared Content-Type.
 */
public record UploadResponse(String id, String fileName, String fileUrl, String signedUrl, String mimeType) {
}
