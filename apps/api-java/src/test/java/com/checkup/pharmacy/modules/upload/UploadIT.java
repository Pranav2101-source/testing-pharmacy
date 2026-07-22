package com.checkup.pharmacy.modules.upload;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.enums.UploadType;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * File uploads (GRN/PO PDFs, prescription scans) backed by Supabase Storage.
 *
 * <p>{@link FakeSupabaseStorageClient} replaces the real HTTP-backed storage
 * client so this exercises {@link UploadService} itself — content-type
 * detection, tenant scoping, size limits — without a network dependency.
 */
@Import(FakeSupabaseStorageClient.Config.class)
@Transactional
class UploadIT extends AbstractPostgresIT {

    @Autowired private UploadService uploadService;
    @Autowired private UploadRepository uploadRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;

    private String pharmacyId;

    // Real magic-byte prefixes: %PDF and the PNG signature. Bodies don't need to be
    // valid documents — MagicBytes only inspects the header.
    private static final byte[] PDF_BYTES = "%PDF-1.4 fake pdf body".getBytes();
    private static final byte[] PNG_BYTES = new byte[]{
            (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @DisplayName("a genuine PDF is accepted and recorded against the caller's pharmacy")
    void genuinePdfIsAccepted() {
        var file = new MockMultipartFile("file", "invoice.pdf", "application/pdf", PDF_BYTES);

        var response = uploadService.upload(file, UploadType.PURCHASE_ORDER_PDF);

        assertThat(response.signedUrl()).isNotBlank();
        assertThat(uploadRepository.findByIdAndPharmacyId(response.id(), pharmacyId)).isPresent();
    }

    /**
     * The defect this pins: validation used to trust {@code file.getContentType()}
     * — the client-supplied multipart header — instead of sniffing the actual bytes.
     * An attacker declares "application/pdf" and uploads anything (an HTML/SVG
     * payload with a script inside, say), and it would have been stored and later
     * served back with a matching, equally fake Content-Type. SupportService's
     * near-identical attachment path already sniffed real bytes via MagicBytes;
     * this one didn't.
     */
    @Test
    @DisplayName("content whose bytes don't match the declared type is rejected, not stored")
    void spoofedContentTypeIsRejected() {
        byte[] scriptPayload = "<script>alert('xss')</script>".getBytes();
        var file = new MockMultipartFile("file", "totally-a.pdf", "application/pdf", scriptPayload);

        long before = uploadRepository.countByPharmacyId(pharmacyId);

        assertThatThrownBy(() -> uploadService.upload(file, UploadType.PRESCRIPTION))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("does not match");

        assertThat(uploadRepository.countByPharmacyId(pharmacyId))
                .as("a rejected upload must not be recorded")
                .isEqualTo(before);
    }

    @Test
    @DisplayName("an unrecognized file format is rejected regardless of its declared type")
    void unrecognizedFormatIsRejected() {
        var file = new MockMultipartFile("file", "data.bin", "application/pdf", new byte[]{1, 2, 3, 4, 5});

        assertThatThrownBy(() -> uploadService.upload(file, UploadType.PRESCRIPTION))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("a genuine PNG is accepted even if mislabelled as a PDF")
    void byteSniffingOverridesAWrongButHarmlessLabel() {
        var file = new MockMultipartFile("file", "scan.pdf", "application/pdf", PNG_BYTES);

        var response = uploadService.upload(file, UploadType.PRESCRIPTION);

        assertThat(response.mimeType())
                .as("the stored type must reflect what the bytes actually are")
                .isEqualTo("image/png");
    }

    @Test
    @DisplayName("an empty upload is rejected")
    void emptyFileIsRejected() {
        var file = new MockMultipartFile("file", "empty.pdf", "application/pdf", new byte[0]);

        assertThatThrownBy(() -> uploadService.upload(file, UploadType.PRESCRIPTION))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("another pharmacy's upload is not addressable")
    void anotherPharmacysUploadIsNotAddressable() {
        var file = new MockMultipartFile("file", "invoice.pdf", "application/pdf", PDF_BYTES);
        var response = uploadService.upload(file, UploadType.PURCHASE_ORDER_PDF);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherOwner = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        authenticateAs(otherOwner.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> uploadService.getSignedUrl(response.id()))
                .isInstanceOf(NotFoundException.class);
    }
}
