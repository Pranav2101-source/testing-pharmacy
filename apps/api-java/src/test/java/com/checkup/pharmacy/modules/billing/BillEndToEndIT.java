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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * One real bill, over HTTP, against a real Postgres carrying the real migrations.
 *
 * <p>WHY THIS EXISTS ALONGSIDE THE SERVICE-LEVEL TESTS
 *
 * <p>Every other billing test calls {@code BillingService} directly, which skips the
 * two layers where this change could still be wrong: JSON binding of the REQUEST (does
 * {@code billDiscountPct} / {@code extraCharges} / {@code adjustmentAmount} actually
 * arrive?) and JSON serialisation of the RESPONSE (do the three new columns actually
 * come back?). A DTO field that fails to bind is invisible to a service test — it just
 * looks like the caller passed null — and that is precisely the failure mode of the
 * work under test here.
 *
 * <p>It then reads the two compliance reports back over HTTP and checks they agree
 * with the invoice and with each other, which is the end of the chain the pharmacist
 * actually sees.
 */
@Transactional
@AutoConfigureMockMvc
class BillEndToEndIT extends AbstractPostgresIT {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private UserPrincipal principal;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        // MRP 100 @ 12% GST — round numbers so the arithmetic below is readable.
        Medicine medicine = medicineRepository.save(Medicine.create("Paracetamol 500", new BigDecimal("12")));
        batchId = inventoryRepository.save(Inventory.create(pharmacy.getId(), medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("60.00"), new BigDecimal("100.00"), 10, 5)).getId();

        principal = new UserPrincipal(user.getId(), pharmacy.getId(), Role.OWNER, user.getEmail());
        entityManager.flush();
        entityManager.clear();
        authenticateAs(user.getId(), pharmacy.getId(), Role.OWNER);
    }

    @Test
    @DisplayName("a bill with discount, charges and an adjustment reconciles from the API response")
    void billReconcilesOverHttp() throws Exception {
        // 4 x Rs.100 = Rs.400 gross, 10% bill discount, +Rs.25 delivery, -Rs.3.50 goodwill.
        String body = """
                {
                  "paymentMode": "CASH",
                  "paymentStatus": "PAID",
                  "billDiscountPct": 10,
                  "extraCharges": 25,
                  "adjustmentAmount": -3.50,
                  "items": [{"inventoryId": "%s", "quantity": 4, "discount": 0}]
                }
                """.formatted(batchId);

        JsonNode invoice = call(post("/api/v1/billing")
                .contentType(MediaType.APPLICATION_JSON).content(body));

        BigDecimal taxable = money(invoice, "taxableAmount");
        BigDecimal totalGst = money(invoice, "totalGst");
        BigDecimal extra = money(invoice, "extraCharges");
        BigDecimal adjustment = money(invoice, "adjustmentAmount");
        BigDecimal roundOff = money(invoice, "roundOff");
        BigDecimal total = money(invoice, "totalAmount");

        // The three new columns survived the round trip — request binding and response
        // serialisation both work, which no service-level test can show.
        assertThat(extra).isEqualByComparingTo("25");
        assertThat(adjustment).isEqualByComparingTo("-3.50");

        // The identity the whole change exists to make true.
        assertThat(taxable.add(totalGst).add(extra).add(adjustment).add(roundOff))
                .as("taxable + GST + charges + adjustment + round-off must equal the billed total")
                .isEqualByComparingTo(total);

        // The discount reduced the TAX, not just the total: Rs.400 of goods becomes
        // Rs.360, and the 12% is reverse-calculated out of THAT rather than out of 400.
        //
        // 360.01, not 360.00, and that paisa is deliberate: intra-state splits the tax
        // into CGST and SGST which must be equal and each stored to 2dp, so the half is
        // what gets rounded (19.285... -> 19.29 each) and the pair can land a paisa
        // above the goods value. See GstCalculatorTest
        // #intraStateMayDifferByOnePaisaBecauseCgstMustEqualSgst — the round-off line
        // below is exactly where that paisa is accounted for.
        assertThat(taxable).isEqualByComparingTo("321.43");
        assertThat(totalGst).isEqualByComparingTo("38.58");
        assertThat(taxable.add(totalGst)).isEqualByComparingTo("360.01");
        assertThat(money(invoice, "discountAmount")).isEqualByComparingTo("40.00");
        // 360.01 + 25 - 3.50 = 381.51, rounded to the nearest rupee.
        assertThat(total).isEqualByComparingTo("382");
        assertThat(roundOff).isEqualByComparingTo("0.49");
    }

    @Test
    @DisplayName("the GST summary and the HSN summary agree with the bill and each other")
    void complianceReportsAgreeOverHttp() throws Exception {
        String body = """
                {
                  "paymentMode": "CASH", "paymentStatus": "PAID",
                  "billDiscountPct": 10, "extraCharges": 25, "adjustmentAmount": -3.50,
                  "items": [{"inventoryId": "%s", "quantity": 4, "discount": 0}]
                }
                """.formatted(batchId);
        JsonNode invoice = call(post("/api/v1/billing")
                .contentType(MediaType.APPLICATION_JSON).content(body));

        String from = Instant.now().minus(1, ChronoUnit.HOURS).toString();
        String to = Instant.now().plus(1, ChronoUnit.HOURS).toString();

        JsonNode gst = call(get("/api/v1/reports/gst").param("from", from).param("to", to));
        JsonNode hsn = call(get("/api/v1/reports/gst/hsn-summary").param("from", from).param("to", to));

        BigDecimal gstTaxable = new BigDecimal(gst.get("_sum").get("taxableAmount").asText());
        BigDecimal gstTotalGst = new BigDecimal(gst.get("_sum").get("totalGst").asText());

        // IGST is now reported — a figure the GSTR-1 return needs and that used to be
        // missing entirely from this endpoint.
        assertThat(gst.get("_sum").has("igst")).isTrue();

        // The GST summary reads the invoice HEADER; the HSN summary sums the stored
        // LINES. These are shown side by side on one screen and must not disagree.
        BigDecimal hsnTaxable = BigDecimal.ZERO;
        BigDecimal hsnGst = BigDecimal.ZERO;
        for (JsonNode row : hsn.get("rows")) {
            hsnTaxable = hsnTaxable.add(new BigDecimal(row.get("taxableAmount").asText()));
            hsnGst = hsnGst.add(new BigDecimal(row.get("totalGst").asText()));
        }
        assertThat(hsnTaxable).isEqualByComparingTo(gstTaxable);
        assertThat(hsnGst).isEqualByComparingTo(gstTotalGst);

        // ...and both agree with the bill that produced them.
        assertThat(gstTaxable).isEqualByComparingTo(money(invoice, "taxableAmount"));
        assertThat(gstTotalGst).isEqualByComparingTo(money(invoice, "totalGst"));
    }

    @Test
    @DisplayName("a backwards date range is refused with a message naming both dates")
    void invertedRangeIsRefusedOverHttp() throws Exception {
        String later = Instant.now().toString();
        String earlier = Instant.now().minus(7, ChronoUnit.DAYS).toString();

        String message = mockMvc.perform(get("/api/v1/reports/gst")
                        .param("from", later).param("to", earlier)
                        .with(authentication(auth())))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        // Previously this returned a confident zero for the period — a number somebody
        // files. It now says what is wrong, in the response the UI renders verbatim.
        assertThat(message).contains("is after the");
        assertThat(message).contains("check the date range");
    }

    @Test
    @DisplayName("an unknown drug schedule is refused, not answered with an empty register")
    void unknownScheduleIsRefusedOverHttp() throws Exception {
        String message = mockMvc.perform(get("/api/v1/reports/schedule-h")
                        .param("schedule", "Z")
                        .with(authentication(auth())))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        assertThat(message).contains("not a drug schedule");
        assertThat(message).contains("H, H1, X, G");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** Performs the request, asserts 2xx, and returns the ApiResponse envelope's data. */
    private JsonNode call(MockHttpServletRequestBuilder request) throws Exception {
        String json = mockMvc.perform(request.with(authentication(auth())))
                .andExpect(status().is2xxSuccessful())
                .andReturn().getResponse().getContentAsString();
        JsonNode root = objectMapper.readTree(json);
        assertThat(root.get("success").asBoolean()).as("API envelope reported failure: %s", json).isTrue();
        return root.get("data");
    }

    private UsernamePasswordAuthenticationToken auth() {
        return new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().name())));
    }

    /** BigDecimal from the JSON, so comparisons are exact rather than binary-float. */
    private static BigDecimal money(JsonNode node, String field) {
        assertThat(node.has(field)).as("response is missing '%s'", field).isTrue();
        return new BigDecimal(node.get(field).asText());
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
