package com.checkup.pharmacy.modules.upload;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.UploadType;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A file stored in Supabase Storage (table "uploads") — GRN/PO source PDFs, prescription scans, etc. */
@Entity
@Table(name = "uploads")
public class Upload extends CreatedAtEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "type")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private UploadType type;

    @Column(name = "fileName")
    private String fileName;

    @Column(name = "fileUrl")
    private String fileUrl;

    @Column(name = "fileSize")
    private int fileSize;

    @Column(name = "mimeType")
    private String mimeType;

    protected Upload() {
        // Required by JPA.
    }

    public static Upload create(String pharmacyId, UploadType type, String fileName, String fileUrl,
                                int fileSize, String mimeType) {
        Upload u = new Upload();
        u.assignId(Cuid.generate());
        u.pharmacyId = pharmacyId;
        u.type = type;
        u.fileName = fileName;
        u.fileUrl = fileUrl;
        u.fileSize = fileSize;
        u.mimeType = mimeType;
        return u;
    }

    public String getPharmacyId() { return pharmacyId; }

    public UploadType getType() { return type; }

    public String getFileName() { return fileName; }

    public String getFileUrl() { return fileUrl; }

    public int getFileSize() { return fileSize; }

    public String getMimeType() { return mimeType; }
}
