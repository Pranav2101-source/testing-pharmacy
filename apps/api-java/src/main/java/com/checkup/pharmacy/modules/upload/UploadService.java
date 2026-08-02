package com.checkup.pharmacy.modules.upload;

import com.checkup.pharmacy.common.enums.UploadType;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.storage.SupabaseStorageClient;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.common.util.MagicBytes;
import com.checkup.pharmacy.modules.upload.dto.SignedUrlResponse;
import com.checkup.pharmacy.modules.upload.dto.UploadResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

/**
 * File uploads backed by Supabase Storage — GRN/PO source PDFs, prescription scans. Every
 * upload is scoped to the caller's pharmacy both in the DB row and in the storage path
 * ({@code {pharmacyId}/{type}/{cuid}.{ext}}), so one tenant can never address another's file
 * even if it somehow guessed an id.
 */
@Service
public class UploadService {

    private static final long MAX_FILE_SIZE_BYTES = 10L * 1024 * 1024;
    private static final int SIGNED_URL_TTL_SECONDS = 600;
    private static final Map<String, String> ALLOWED_MIME_TO_EXT = Map.of(
            "application/pdf", "pdf",
            "image/jpeg", "jpg",
            "image/png", "png",
            "image/webp", "webp"
    );

    private final UploadRepository uploadRepository;
    private final SupabaseStorageClient storageClient;

    public UploadService(UploadRepository uploadRepository, SupabaseStorageClient storageClient) {
        this.uploadRepository = uploadRepository;
        this.storageClient = storageClient;
    }

    @Transactional
    public UploadResponse upload(MultipartFile file, UploadType type) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("No file provided");
        }
        if (file.getSize() > MAX_FILE_SIZE_BYTES) {
            throw new BadRequestException("File too large — maximum 10MB");
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BadRequestException("Could not read the uploaded file");
        }

        // Sniffed from the bytes, NOT file.getContentType(). The Content-Type on a
        // multipart part is whatever the client declares — an attacker sets it to
        // "application/pdf" and uploads an .html/.svg payload with a script inside,
        // and this then gets served back with Content-Type: application/pdf on the
        // signed URL, exactly the mislabelling MagicBytes exists to catch. This
        // module accepted the header at face value while SupportService's
        // near-identical attachment upload already did this correctly.
        String detected = MagicBytes.detect(bytes);
        String ext = detected == null ? null : ALLOWED_MIME_TO_EXT.get(detected);
        if (ext == null) {
            throw new BadRequestException(
                    "File content does not match its declared format. Allowed: PDF, JPEG, PNG, WEBP.");
        }

        String pharmacyId = TenantContext.pharmacyId();
        String path = pharmacyId + "/" + type.name() + "/" + Cuid.generate() + "." + ext;
        storageClient.upload(path, bytes, detected);

        String fileName = file.getOriginalFilename() == null ? "upload." + ext : file.getOriginalFilename();
        Upload upload = Upload.create(pharmacyId, type, fileName, path, (int) file.getSize(), detected);
        uploadRepository.save(upload);

        String signedUrl = storageClient.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        return new UploadResponse(upload.getId(), upload.getFileName(), upload.getFileUrl(), signedUrl,
                upload.getMimeType());
    }

    @Transactional(readOnly = true)
    public SignedUrlResponse getSignedUrl(String id) {
        Upload upload = uploadRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Upload not found"));
        return new SignedUrlResponse(storageClient.createSignedUrl(upload.getFileUrl(), SIGNED_URL_TTL_SECONDS));
    }
}
