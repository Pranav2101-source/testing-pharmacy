package com.checkup.pharmacy.modules.pharmacy;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.pharmacy.dto.UpdatePharmacyRequest;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The pharmacy profile — the tenant's own name, GSTIN, drug licence and address.
 *
 * <p>Worth its own suite despite being small CRUD, because these fields are not
 * cosmetic: the GSTIN and drug-licence number print on every invoice a pharmacy
 * issues, and a wrong or silently-cleared value makes those invoices
 * non-compliant. The scoping tests matter for the same reason — this is the one
 * record shared by every user in a tenant.
 */
@Transactional
class PharmacyIT extends AbstractPostgresIT {

    @Autowired private PharmacyService pharmacyService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;
    @Autowired private ObjectMapper objectMapper;

    private String pharmacyId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        flushAndClear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private static UpdatePharmacyRequest full(String name) {
        return new UpdatePharmacyRequest(name, "9876543210", "shop@example.com",
                "29ABCDE1234F1Z5", "KA-B-123456", "12 MG Road", "Bengaluru", "Karnataka",
                "560001", "https://cdn.example.com/logo.png");
    }

    @Nested
    @DisplayName("reading the profile")
    class Read {

        @Test
        @DisplayName("returns the caller's own pharmacy")
        void returnsOwnPharmacy() {
            var res = pharmacyService.getCurrent();
            assertThat(res.name()).isEqualTo("Test Pharmacy");
        }

        @Test
        @DisplayName("a brand-new pharmacy reads back with null profile fields, not an error")
        void newPharmacyHasEmptyProfile() {
            // The onboarding flow creates a pharmacy with only name+slug; the settings
            // page must render that state rather than 500.
            var res = pharmacyService.getCurrent();
            assertThat(res.gstin()).isNull();
            assertThat(res.drugLicense()).isNull();
            assertThat(res.documents()).isNull();
        }

        @Test
        @DisplayName("404s when the tenant's pharmacy row is gone")
        void missingPharmacyIsNotFound() {
            authenticateAs("user-x", "pharmacy-that-does-not-exist", Role.OWNER);
            assertThatThrownBy(() -> pharmacyService.getCurrent())
                    .isInstanceOf(NotFoundException.class);
        }
    }

    @Nested
    @DisplayName("updating the profile")
    class Update {

        @Test
        @DisplayName("persists every profile field")
        void persistsAllFields() {
            pharmacyService.update(full("Apollo Pharmacy"));
            flushAndClear();

            var res = pharmacyService.getCurrent();
            assertThat(res.name()).isEqualTo("Apollo Pharmacy");
            assertThat(res.phone()).isEqualTo("9876543210");
            assertThat(res.email()).isEqualTo("shop@example.com");
            assertThat(res.gstin()).isEqualTo("29ABCDE1234F1Z5");
            assertThat(res.drugLicense()).isEqualTo("KA-B-123456");
            assertThat(res.address()).isEqualTo("12 MG Road");
            assertThat(res.city()).isEqualTo("Bengaluru");
            assertThat(res.state()).isEqualTo("Karnataka");
            assertThat(res.pincode()).isEqualTo("560001");
            assertThat(res.logoUrl()).isEqualTo("https://cdn.example.com/logo.png");
        }

        @Test
        @DisplayName("trims surrounding whitespace from the name")
        void trimsName() {
            // The name prints as the header of every invoice; leading spaces there
            // are visible and look broken.
            pharmacyService.update(new UpdatePharmacyRequest("   Spaced Pharmacy   ",
                    null, null, null, null, null, null, null, null, null));
            flushAndClear();

            assertThat(pharmacyService.getCurrent().name()).isEqualTo("Spaced Pharmacy");
        }

        @Test
        @DisplayName("a null field CLEARS that column — the form submits the whole record")
        void nullFieldClearsColumn() {
            // Documents the contract stated on UpdatePharmacyRequest. It is a genuine
            // footgun: a partial PATCH-style body would wipe GSTIN and drug licence
            // off every future invoice, so any client must send the full record.
            pharmacyService.update(full("Apollo Pharmacy"));
            flushAndClear();
            assertThat(pharmacyService.getCurrent().gstin()).isNotNull();

            pharmacyService.update(new UpdatePharmacyRequest("Apollo Pharmacy",
                    null, null, null, null, null, null, null, null, null));
            flushAndClear();

            var res = pharmacyService.getCurrent();
            assertThat(res.gstin()).isNull();
            assertThat(res.drugLicense()).isNull();
            assertThat(res.name()).isEqualTo("Apollo Pharmacy");
        }

        @Test
        @DisplayName("the returned response reflects the update without needing a re-read")
        void responseReflectsUpdate() {
            var res = pharmacyService.update(full("Immediate Pharmacy"));
            assertThat(res.name()).isEqualTo("Immediate Pharmacy");
            assertThat(res.city()).isEqualTo("Bengaluru");
        }

        @Test
        @DisplayName("updating twice keeps the last value, not a merge")
        void secondUpdateWins() {
            pharmacyService.update(full("First Name"));
            flushAndClear();
            pharmacyService.update(full("Second Name"));
            flushAndClear();

            assertThat(pharmacyService.getCurrent().name()).isEqualTo("Second Name");
        }

        @Test
        @DisplayName("404s rather than creating a row when the tenant has no pharmacy")
        void updateOnMissingPharmacyIsNotFound() {
            authenticateAs("user-x", "pharmacy-that-does-not-exist", Role.OWNER);
            assertThatThrownBy(() -> pharmacyService.update(full("Ghost Pharmacy")))
                    .isInstanceOf(NotFoundException.class);
        }
    }

    @Nested
    @DisplayName("tenant isolation")
    class Isolation {

        @Test
        @DisplayName("updating one pharmacy leaves another pharmacy's profile untouched")
        void updateDoesNotLeakAcrossTenants() {
            // The single most important property of this module: two pharmacies share
            // one table and one endpoint, distinguished only by TenantContext.
            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            String otherId = other.getId();
            flushAndClear();

            pharmacyService.update(full("Renamed By Tenant A"));
            flushAndClear();

            Pharmacy reloaded = pharmacyRepository.findById(otherId).orElseThrow();
            assertThat(reloaded.getName()).isEqualTo("Other Pharmacy");
            assertThat(reloaded.getGstin()).isNull();
        }

        @Test
        @DisplayName("each tenant reads back only its own profile through the same endpoint")
        void eachTenantSeesOwnProfile() {
            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
            User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                    "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
            flushAndClear();

            pharmacyService.update(full("Tenant A Pharmacy"));
            flushAndClear();

            authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
            assertThat(pharmacyService.getCurrent().name()).isEqualTo("Other Pharmacy");

            authenticateAs("back", pharmacyId, Role.OWNER);
            assertThat(pharmacyService.getCurrent().name()).isEqualTo("Tenant A Pharmacy");
        }
    }

    @Nested
    @DisplayName("documents (drug licence scans, GST certificate)")
    class Documents {

        @Test
        @DisplayName("round-trips a stored document list")
        void roundTripsDocuments() throws Exception {
            var docs = objectMapper.readTree(
                    "[{\"name\":\"Drug Licence\",\"url\":\"https://cdn/dl.pdf\",\"uploadedAt\":\"2026-01-05\"}]");
            pharmacyService.updateDocuments(docs);
            flushAndClear();

            var res = pharmacyService.getCurrent();
            assertThat(res.documents()).isNotNull();
            assertThat(res.documents().isArray()).isTrue();
            assertThat(res.documents().get(0).get("name").asText()).isEqualTo("Drug Licence");
        }

        @Test
        @DisplayName("a null body clears the stored documents")
        void nullClearsDocuments() throws Exception {
            pharmacyService.updateDocuments(objectMapper.readTree("[{\"name\":\"X\"}]"));
            flushAndClear();
            assertThat(pharmacyService.getCurrent().documents()).isNotNull();

            pharmacyService.updateDocuments(null);
            flushAndClear();
            assertThat(pharmacyService.getCurrent().documents()).isNull();
        }

        @Test
        @DisplayName("an explicit JSON null clears the stored documents too")
        void jsonNullClearsDocuments() throws Exception {
            pharmacyService.updateDocuments(objectMapper.readTree("[{\"name\":\"X\"}]"));
            flushAndClear();

            pharmacyService.updateDocuments(objectMapper.nullNode());
            flushAndClear();
            assertThat(pharmacyService.getCurrent().documents()).isNull();
        }

        @Test
        @DisplayName("an empty array is stored as an empty array, not as null")
        void emptyArrayIsPreserved() throws Exception {
            // "the user deleted their last document" must be distinguishable from
            // "documents were never set", or the UI cannot tell an empty list from
            // an unconfigured one.
            pharmacyService.updateDocuments(objectMapper.readTree("[]"));
            flushAndClear();

            var docs = pharmacyService.getCurrent().documents();
            assertThat(docs).isNotNull();
            assertThat(docs.isArray()).isTrue();
            assertThat(docs).isEmpty();
        }

        @Test
        @DisplayName("the database itself refuses to store invalid JSON in `documents`")
        void databaseRejectsInvalidJson() {
            // `Pharmacy.documents` maps to a Postgres `Json` column (schema.prisma:41),
            // so malformed content is rejected at write time — the profile can never
            // hold a value that would later fail to parse on read.
            //
            // This test was originally written the other way round, to exercise
            // PharmacyService.parseDocuments' catch branch by planting a corrupt value.
            // It could not: the INSERT is refused first. That makes the catch branch
            // unreachable through the database, which is worth recording — it is
            // harmless defensive code, not a live safety net, and the real guarantee
            // is this constraint.
            Pharmacy p = pharmacyRepository.findById(pharmacyId).orElseThrow();
            p.setDocuments("{not valid json");
            pharmacyRepository.save(p);

            // Asserted on the message, not the exception class: a direct
            // EntityManager.flush() surfaces Hibernate's own DataException, whereas the
            // same write through a repository method would arrive already translated to
            // Spring's DataAccessException. The guarantee under test is Postgres's, and
            // it holds either way.
            assertThatThrownBy(this::forceFlush)
                    .hasMessageContaining("invalid input syntax for type json");
        }

        private void forceFlush() {
            entityManager.flush();
        }

        @Test
        @DisplayName("a well-formed but unexpected shape is stored and returned as-is")
        void unexpectedShapeIsPreserved() {
            // Valid JSON that is not the StoredDoc[] the UI expects (here an object,
            // not an array). The profile read must not fail — the settings page can
            // decide what to render; a 500 here would take the whole page down.
            pharmacyService.updateDocuments(objectMapper.createObjectNode().put("legacy", true));
            flushAndClear();

            var docs = pharmacyService.getCurrent().documents();
            assertThat(docs).isNotNull();
            assertThat(docs.isObject()).isTrue();
            assertThat(docs.get("legacy").asBoolean()).isTrue();
        }

        @Test
        @DisplayName("updating documents leaves the rest of the profile alone")
        void documentsUpdateDoesNotTouchProfile() throws Exception {
            pharmacyService.update(full("Apollo Pharmacy"));
            flushAndClear();

            pharmacyService.updateDocuments(objectMapper.readTree("[{\"name\":\"GST Cert\"}]"));
            flushAndClear();

            var res = pharmacyService.getCurrent();
            assertThat(res.gstin()).isEqualTo("29ABCDE1234F1Z5");
            assertThat(res.drugLicense()).isEqualTo("KA-B-123456");
            assertThat(res.name()).isEqualTo("Apollo Pharmacy");
        }
    }
}
