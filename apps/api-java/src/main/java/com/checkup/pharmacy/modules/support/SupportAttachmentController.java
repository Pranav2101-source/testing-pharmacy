package com.checkup.pharmacy.modules.support;

import com.checkup.pharmacy.common.exception.NotFoundException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves uploaded ticket attachments at the literal path {@code /api/support/attachments/...}
 * — deliberately NOT under {@code /api/v1} — because the frontend's {@code useAuthUrl} hook
 * (TicketDetailPage.tsx) builds the request URL by concatenating the API origin directly with
 * the {@code fileUrl} stored on the attachment record, bypassing axios's {@code /api/v1}
 * baseURL. This must stay byte-for-byte consistent with whatever prefix
 * {@link SupportService#addAttachment} writes into {@code fileUrl}.
 */
@RestController
@RequestMapping("/api/support/attachments")
public class SupportAttachmentController {

    private final SupportService supportService;

    public SupportAttachmentController(SupportService supportService) {
        this.supportService = supportService;
    }

    @GetMapping("/{filename}")
    public ResponseEntity<byte[]> download(@PathVariable String filename) {
        // Stored names are always cuid+extension; reject anything containing path
        // traversal or unexpected characters rather than trying to sanitize it.
        String safe = filename.replaceAll("[^a-zA-Z0-9._-]", "");
        if (safe.isEmpty() || !safe.equals(filename) || safe.contains("..")) {
            throw new NotFoundException("File not found");
        }

        SupportService.AttachmentDownload download = supportService.getAttachmentBytes(safe);

        // Images/videos render inline in the ticket UI; everything else (incl. PDF) downloads
        // as an attachment so browsers never execute embedded content at the API's origin.
        boolean inline = download.mimeType().startsWith("image/") || download.mimeType().startsWith("video/");
        String downloadName = download.fileName().replaceAll("[\"\r\n]", "");

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, download.mimeType())
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        (inline ? "inline" : "attachment") + "; filename=\"" + downloadName + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=86400")
                .body(download.bytes());
    }
}
