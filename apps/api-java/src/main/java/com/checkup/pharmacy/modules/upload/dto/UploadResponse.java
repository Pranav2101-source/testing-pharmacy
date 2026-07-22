package com.checkup.pharmacy.modules.upload.dto;

public record UploadResponse(String id, String fileName, String signedUrl, String mimeType) {
}
