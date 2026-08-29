package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.security.UserPrincipal;
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
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Local-only verification for the EMR-prescription "walk-in customer" fix — NOT meant to be
 * committed (see feedback_no_test_files_in_commits memory), just proof the wiring works before
 * reporting it as done.
 *
 * <p>Confirms customerName/customerPhone survive create-invoice even with no customerId, which
 * is exactly the EMR-prescription case: BillingService previously only ever read them off a
 * matched Customer row, so a prescription's free-text patientName/patientPhone were silently
 * dropped and the invoice fell back to a null customerName (displayed as "Walk-in Customer").
 */
@Transactional
@AutoConfigureMockMvc
class EmrBillingWiringIT extends AbstractPostgresIT {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private User owner;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        owner = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Paracetamol 500", new BigDecimal("12")));
        batchId = inventoryRepository.save(Inventory.create(pharmacy.getId(), medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("60.00"), new BigDecimal("100.00"), 10, 5)).getId();
        entityManager.flush();
        entityManager.clear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @DisplayName("an EMR prescription's patient name/phone survive to the invoice with no customerId")
    void patientNameSurvivesWithoutCustomerId() throws Exception {
        String body = """
                {
                  "customerName": "Priya Sharma",
                  "customerPhone": "9812345678",
                  "paymentMode": "CASH",
                  "paymentStatus": "PAID",
                  "items": [{"inventoryId": "%s", "quantity": 2, "discount": 0}]
                }
                """.formatted(batchId);

        String json = mockMvc.perform(post("/api/v1/billing")
                        .contentType(MediaType.APPLICATION_JSON).content(body)
                        .with(authentication(authFor(owner))))
                .andExpect(status().is2xxSuccessful())
                .andReturn().getResponse().getContentAsString();

        JsonNode invoice = objectMapper.readTree(json).get("data");
        assertThat(invoice.get("customerName").asText()).isEqualTo("Priya Sharma");
        assertThat(invoice.get("customerPhone").asText()).isEqualTo("9812345678");
    }

    private UsernamePasswordAuthenticationToken authFor(User user) {
        var principal = new UserPrincipal(user.getId(), user.getPharmacyId(), user.getRole(), user.getEmail());
        return new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name())));
    }
}
