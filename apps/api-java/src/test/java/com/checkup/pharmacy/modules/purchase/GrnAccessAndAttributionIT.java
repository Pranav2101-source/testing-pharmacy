package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Over HTTP, not service-level: {@code PurchaseIT} calls {@code PurchasesService} directly,
 * which never touches the {@code @PreAuthorize} annotations on {@code PurchasesController} —
 * a role check that silently stopped applying (or a JSON field that fails to bind/serialize)
 * would be invisible there. This is the layer where "staff got Forbidden saving a GRN" was
 * actually reported, and where the fix (widening to MANAGER/PHARMACIST) and the new
 * createdBy/confirmedBy attribution both need to be proven over the real HTTP+JSON path.
 */
@Transactional
@AutoConfigureMockMvc
class GrnAccessAndAttributionIT extends AbstractPostgresIT {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String supplierId;
    private String medicineId;
    private User owner;
    private User manager;
    private User pharmacist;
    private User cashier;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        owner = userRepository.save(User.create(pharmacyId, "Om Owner",
                "owner-" + unique() + "@test.local", "9000000001", "hash", Role.OWNER));
        manager = userRepository.save(User.create(pharmacyId, "Mira Manager",
                "manager-" + unique() + "@test.local", "9000000002", "hash", Role.MANAGER));
        pharmacist = userRepository.save(User.create(pharmacyId, "Priya Pharmacist",
                "pharmacist-" + unique() + "@test.local", "9000000003", "hash", Role.PHARMACIST));
        cashier = userRepository.save(User.create(pharmacyId, "Chetan Cashier",
                "cashier-" + unique() + "@test.local", "9000000004", "hash", Role.CASHIER));
        supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Acme Distributors")).getId();
        medicineId = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12"))).getId();
        entityManager.flush();
        entityManager.clear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @DisplayName("CASHIER is refused at the HTTP layer when saving a GRN — the reported bug")
    void cashierCannotCreateGrn() throws Exception {
        mockMvc.perform(post("/api/v1/purchases/grn")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createGrnBody())
                        .with(authentication(authFor(cashier))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("PHARMACIST can create and confirm a GRN, and both actors are attributed by name")
    void pharmacistCreatesManagerConfirms() throws Exception {
        JsonNode created = call(post("/api/v1/purchases/grn")
                .contentType(MediaType.APPLICATION_JSON).content(createGrnBody()), pharmacist);

        assertThat(created.get("status").asText()).isEqualTo("DRAFT");
        assertThat(created.get("createdBy").get("id").asText()).isEqualTo(pharmacist.getId());
        assertThat(created.get("createdBy").get("name").asText()).isEqualTo("Priya Pharmacist");
        // Not yet confirmed — no confirmer to attribute.
        assertThat(created.get("confirmedBy").isNull()).isTrue();

        String grnId = created.get("id").asText();

        // A CASHIER still can't confirm it — widening create/confirm stopped at
        // MANAGER/PHARMACIST, not everyone.
        mockMvc.perform(patch("/api/v1/purchases/grn/{id}/confirm", grnId)
                        .with(authentication(authFor(cashier))))
                .andExpect(status().isForbidden());

        JsonNode confirmed = call(patch("/api/v1/purchases/grn/{id}/confirm", grnId), manager);

        assertThat(confirmed.get("status").asText()).isEqualTo("CONFIRMED");
        // Creator attribution survives confirm untouched...
        assertThat(confirmed.get("createdBy").get("id").asText()).isEqualTo(pharmacist.getId());
        // ...and the confirmer is the manager who actually confirmed it, not the creator.
        assertThat(confirmed.get("confirmedBy").get("id").asText()).isEqualTo(manager.getId());
        assertThat(confirmed.get("confirmedBy").get("name").asText()).isEqualTo("Mira Manager");
    }

    @Test
    @DisplayName("the GRN list page resolves createdBy/confirmedBy too, not just the single-record view")
    void listPageCarriesAttribution() throws Exception {
        JsonNode created = call(post("/api/v1/purchases/grn")
                .contentType(MediaType.APPLICATION_JSON).content(createGrnBody()), pharmacist);
        call(patch("/api/v1/purchases/grn/{id}/confirm", created.get("id").asText()), owner);

        JsonNode page = call(get("/api/v1/purchases/grn"), owner);
        JsonNode row = page.get("items").get(0);
        assertThat(row.get("createdBy").get("name").asText()).isEqualTo("Priya Pharmacist");
        assertThat(row.get("confirmedBy").get("name").asText()).isEqualTo("Om Owner");
    }

    @Test
    @DisplayName("update and cancel are still refused for CASHIER")
    void cashierCannotUpdateOrCancel() throws Exception {
        JsonNode created = call(post("/api/v1/purchases/grn")
                .contentType(MediaType.APPLICATION_JSON).content(createGrnBody()), pharmacist);
        String grnId = created.get("id").asText();

        mockMvc.perform(patch("/api/v1/purchases/grn/{id}", grnId)
                        .contentType(MediaType.APPLICATION_JSON).content("{}")
                        .with(authentication(authFor(cashier))))
                .andExpect(status().isForbidden());

        mockMvc.perform(delete("/api/v1/purchases/grn/{id}", grnId)
                        .with(authentication(authFor(cashier))))
                .andExpect(status().isForbidden());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String createGrnBody() {
        return """
                {
                  "supplierId": "%s",
                  "supplierInvoiceNo": "INV-%s",
                  "supplierInvoiceDate": "%s",
                  "items": [{
                    "medicineId": "%s",
                    "medicineName": "Amoxicillin 250",
                    "batchNumber": "BATCH-%s",
                    "expiryDate": "%s",
                    "orderedQty": 0,
                    "receivedQty": 50,
                    "freeQty": 0,
                    "purchaseRate": 10.00,
                    "mrp": 20.00,
                    "discount": 0,
                    "gstRate": 12
                  }]
                }
                """.formatted(supplierId, unique(), Instant.now(), medicineId, unique(),
                Instant.now().plus(365, ChronoUnit.DAYS));
    }

    /** Performs the request as the given user, asserts 2xx, and returns the ApiResponse envelope's data. */
    private JsonNode call(MockHttpServletRequestBuilder request, User asUser) throws Exception {
        String json = mockMvc.perform(request.with(authentication(authFor(asUser))))
                .andExpect(status().is2xxSuccessful())
                .andReturn().getResponse().getContentAsString();
        JsonNode root = objectMapper.readTree(json);
        assertThat(root.get("success").asBoolean()).as("API envelope reported failure: %s", json).isTrue();
        return root.get("data");
    }

    private UsernamePasswordAuthenticationToken authFor(User user) {
        var principal = new com.checkup.pharmacy.security.UserPrincipal(
                user.getId(), user.getPharmacyId(), user.getRole(), user.getEmail());
        return new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name())));
    }
}
