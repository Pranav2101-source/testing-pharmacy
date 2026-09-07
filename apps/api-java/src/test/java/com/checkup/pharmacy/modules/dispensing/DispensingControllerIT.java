package com.checkup.pharmacy.modules.dispensing;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The dispensing engine's HTTP surface — auth, JSON shapes, and end-to-end wiring into a real bill. */
@AutoConfigureMockMvc
@Transactional
class DispensingControllerIT extends AbstractPostgresIT {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private UserPrincipal owner;
    private UserPrincipal cashier;
    private String medicineId;
    private String soonBatchId;
    private String laterBatchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User o = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        User c = userRepository.save(User.create(pharmacy.getId(), "Cashier",
                "cashier-" + unique() + "@test.local", "9000000001", "hash", Role.CASHIER));
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 500", new BigDecimal("12")));
        medicineId = medicine.getId();
        // Two batches: SOON expires first (FEFO would take it), LATER received a little after.
        soonBatchId = inventoryRepository.save(Inventory.create(pharmacy.getId(), medicineId, "SOON",
                Instant.now().plus(60, ChronoUnit.DAYS), 10, new BigDecimal("8"), new BigDecimal("20"), 5, 2)).getId();
        laterBatchId = inventoryRepository.save(Inventory.create(pharmacy.getId(), medicineId, "LATER",
                Instant.now().plus(400, ChronoUnit.DAYS), 10, new BigDecimal("8"), new BigDecimal("20"), 5, 2)).getId();

        owner = new UserPrincipal(o.getId(), pharmacy.getId(), Role.OWNER, o.getEmail());
        cashier = new UserPrincipal(c.getId(), pharmacy.getId(), Role.CASHIER, c.getEmail());
        entityManager.flush();
        entityManager.clear();
    }

    @Test
    @DisplayName("GET /dispensing/strategy returns LILA_FEFO by default")
    void strategyDefault() throws Exception {
        JsonNode data = call(get("/api/v1/dispensing/strategy"), owner);
        assertThat(data.get("strategy").asText()).isEqualTo("LILA_FEFO");
        assertThat(data.get("defaultStrategy").asText()).isEqualTo("LILA_FEFO");
    }

    @Test
    @DisplayName("PUT /dispensing/strategy: owner may change it, cashier may not, an unknown value is rejected")
    void strategyUpdateAuth() throws Exception {
        mockMvc.perform(put("/api/v1/dispensing/strategy")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"strategy\":\"LIFA\"}")
                        .with(authentication(auth(cashier))))
                .andExpect(status().isForbidden());

        JsonNode data = call(put("/api/v1/dispensing/strategy")
                .contentType(MediaType.APPLICATION_JSON).content("{\"strategy\":\"LIFA\"}"), owner);
        assertThat(data.get("strategy").asText()).isEqualTo("LIFA");

        mockMvc.perform(put("/api/v1/dispensing/strategy")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"strategy\":\"NONSENSE\"}")
                        .with(authentication(auth(owner))))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("GET /dispensing/batches returns the medicine's batches in strategy order, and it flips with the setting")
    void batchesFollowStrategy() throws Exception {
        JsonNode fefo = call(get("/api/v1/dispensing/batches").param("medicineId", medicineId), owner);
        assertThat(fefo.get(0).get("batchNumber").asText()).isEqualTo("SOON");

        call(put("/api/v1/dispensing/strategy")
                .contentType(MediaType.APPLICATION_JSON).content("{\"strategy\":\"LIFA\"}"), owner);

        JsonNode lifa = call(get("/api/v1/dispensing/batches").param("medicineId", medicineId), owner);
        assertThat(lifa.get(0).get("batchNumber").asText()).isEqualTo("LATER");
    }

    @Test
    @DisplayName("POST /dispensing/plan allocates the required pieces from the ordered batches")
    void planEndpoint() throws Exception {
        String body = """
                { "lines": [ { "medicineId": "%s", "requiredPieces": 12 } ] }
                """.formatted(medicineId);
        JsonNode data = call(post("/api/v1/dispensing/plan")
                .contentType(MediaType.APPLICATION_JSON).content(body), owner);

        assertThat(data.get("strategy").asText()).isEqualTo("LILA_FEFO");
        JsonNode line = data.get("lines").get(0);
        assertThat(line.get("fullyAllocated").asBoolean()).isTrue();
        // upp defaults to 1 here (no pack size set), so 12 pieces = 12 packs from the SOON batch first.
        assertThat(line.get("allocations").get(0).get("batchNumber").asText()).isEqualTo("SOON");
    }

    @Test
    @DisplayName("POST /dispensing/plan rejects a bad line with a message that names the line and the problem")
    void planRejectsBadLine() throws Exception {
        String noId = "{ \"lines\": [ { \"requiredPieces\": 5 } ] }";
        String msg1 = mockMvc.perform(post("/api/v1/dispensing/plan")
                        .contentType(MediaType.APPLICATION_JSON).content(noId)
                        .with(authentication(auth(owner))))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        assertThat(msg1).contains("Line 1").contains("medicineId");

        String zeroQty = "{ \"lines\": [ { \"medicineId\": \"" + medicineId + "\", \"requiredPieces\": 0 } ] }";
        mockMvc.perform(post("/api/v1/dispensing/plan")
                        .contentType(MediaType.APPLICATION_JSON).content(zeroQty)
                        .with(authentication(auth(owner))))
                .andExpect(status().isBadRequest());

        String badMed = "{ \"lines\": [ { \"medicineId\": \"does-not-exist\", \"requiredPieces\": 5 } ] }";
        String msg3 = mockMvc.perform(post("/api/v1/dispensing/plan")
                        .contentType(MediaType.APPLICATION_JSON).content(badMed)
                        .with(authentication(auth(owner))))
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();
        assertThat(msg3).contains("does-not-exist");
    }

    @Test
    @DisplayName("a bill placed over HTTP carries the strategy snapshot and the batchAutoSelected flag")
    void billSnapshotsStrategyOverHttp() throws Exception {
        String body = """
                {
                  "paymentMode": "CASH", "paymentStatus": "PAID",
                  "items": [
                    {"inventoryId": "%s", "quantity": 2, "discount": 0},
                    {"inventoryId": "%s", "quantity": 1, "discount": 0, "batchAutoSelected": false}
                  ]
                }
                """.formatted(soonBatchId, laterBatchId);
        JsonNode invoice = call(post("/api/v1/billing")
                .contentType(MediaType.APPLICATION_JSON).content(body), owner);

        assertThat(invoice.get("dispensingStrategy").asText()).isEqualTo("LILA_FEFO");
        JsonNode items = invoice.get("items");
        boolean sawAuto = false;
        boolean sawManual = false;
        for (JsonNode it : items) {
            if ("SOON".equals(it.get("batchNumber").asText())) {
                sawAuto = it.get("batchAutoSelected").asBoolean();
            } else if ("LATER".equals(it.get("batchNumber").asText())) {
                sawManual = !it.get("batchAutoSelected").asBoolean();
            }
        }
        assertThat(sawAuto).as("engine-picked line recorded as auto").isTrue();
        assertThat(sawManual).as("hand-picked line recorded as override").isTrue();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private JsonNode call(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
                          UserPrincipal as) throws Exception {
        String json = mockMvc.perform(request.with(authentication(auth(as))))
                .andExpect(status().is2xxSuccessful())
                .andReturn().getResponse().getContentAsString();
        JsonNode root = objectMapper.readTree(json);
        assertThat(root.get("success").asBoolean()).as("API envelope reported failure: %s", json).isTrue();
        return root.get("data");
    }

    private UsernamePasswordAuthenticationToken auth(UserPrincipal p) {
        return new UsernamePasswordAuthenticationToken(p, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + p.role().name())));
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
