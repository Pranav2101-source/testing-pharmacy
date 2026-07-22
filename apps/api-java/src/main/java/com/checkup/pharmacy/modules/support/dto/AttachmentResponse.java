package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.common.enums.AttachmentFileType;
import com.checkup.pharmacy.modules.support.TicketAttachment;

public record AttachmentResponse(String id, String fileName, String fileUrl, int fileSize, String mimeType,
                                 AttachmentFileType fileType) {

    public static AttachmentResponse from(TicketAttachment a) {
        return new AttachmentResponse(a.getId(), a.getFileName(), a.getFileUrl(), a.getFileSize(), a.getMimeType(),
                a.getFileType());
    }
}
