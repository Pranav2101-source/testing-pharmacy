package com.checkup.pharmacy.modules.upload;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.common.enums.UploadType;
import com.checkup.pharmacy.modules.upload.dto.SignedUrlResponse;
import com.checkup.pharmacy.modules.upload.dto.UploadResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * File uploads under /api/v1/uploads — tenant-scoped, open to any authenticated staff member
 * (the same routine POS/receiving/prescribing tasks these files attach to are open to all staff).
 */
@RestController
@RequestMapping("/api/v1/uploads")
public class UploadController {

    private final UploadService uploadService;

    public UploadController(UploadService uploadService) {
        this.uploadService = uploadService;
    }

    @PostMapping("/prescription")
    public ResponseEntity<ApiResponse<UploadResponse>> uploadPrescription(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(uploadService.upload(file, UploadType.PRESCRIPTION)));
    }

    @PostMapping("/po-pdf")
    public ResponseEntity<ApiResponse<UploadResponse>> uploadPoPdf(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(uploadService.upload(file, UploadType.PURCHASE_ORDER_PDF)));
    }

    @PostMapping("/grn-pdf")
    public ResponseEntity<ApiResponse<UploadResponse>> uploadGrnPdf(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(uploadService.upload(file, UploadType.GRN_PDF)));
    }

    /**
     * Pharmacy logo, set from Settings → Profile.
     *
     * <p>This route and {@link #uploadPharmacyDocument} were MISSING while the
     * frontend called both — {@code UploadType.LOGO} and
     * {@code UploadType.PHARMACY_DOCUMENT} existed in the enum and the Prisma
     * schema, but nothing exposed them. Every logo upload and every compliance-
     * document upload 404'd, which the settings screens then reported as a generic
     * "Failed to save" (logo) or swallowed entirely (documents).
     */
    @PostMapping("/pharmacy-logo")
    public ResponseEntity<ApiResponse<UploadResponse>> uploadPharmacyLogo(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(uploadService.upload(file, UploadType.LOGO)));
    }

    /** Drug licence, GST certificate and the rest of Settings → Documents &amp; Legal. */
    @PostMapping("/pharmacy-document")
    public ResponseEntity<ApiResponse<UploadResponse>> uploadPharmacyDocument(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(uploadService.upload(file, UploadType.PHARMACY_DOCUMENT)));
    }

    @GetMapping("/{id}/signed-url")
    public ApiResponse<SignedUrlResponse> getSignedUrl(@PathVariable String id) {
        return ApiResponse.ok(uploadService.getSignedUrl(id));
    }
}
