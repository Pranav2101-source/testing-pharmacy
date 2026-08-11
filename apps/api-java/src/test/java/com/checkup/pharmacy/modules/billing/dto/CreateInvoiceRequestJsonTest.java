package com.checkup.pharmacy.modules.billing.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * JSON binding for the invoice request.
 *
 * <p>This record carries a second, shorter constructor so the ~30 positional call
 * sites that predate {@code sessionId} did not all have to churn. That is only safe
 * if Jackson still binds through the CANONICAL constructor — if it ever picked the
 * compatibility overload instead, {@code sessionId} would silently arrive as null on
 * every request and the reservation fix would quietly stop working, with no
 * compilation error and no test failure anywhere else.
 *
 * <p>So the overload's safety is pinned here rather than assumed.
 */
class CreateInvoiceRequestJsonTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("sessionId binds from the request body")
    void bindsSessionId() throws Exception {
        String json = """
                {
                  "idempotencyKey": "key-1",
                  "sessionId": "session-abc",
                  "items": [{"inventoryId": "inv-1", "quantity": 2, "discount": 0}]
                }
                """;

        CreateInvoiceRequest req = mapper.readValue(json, CreateInvoiceRequest.class);

        assertThat(req.sessionId()).isEqualTo("session-abc");
        assertThat(req.reservationSessionId()).isEqualTo("session-abc");
        assertThat(req.items()).hasSize(1);
    }

    @Test
    @DisplayName("a body without sessionId falls back to the idempotency key")
    void fallsBackToIdempotencyKey() throws Exception {
        // What an older client sends. The web app used the same value for both, so
        // this keeps those callers working rather than silently unreserving nothing.
        String json = """
                {
                  "idempotencyKey": "key-1",
                  "items": [{"inventoryId": "inv-1", "quantity": 2, "discount": 0}]
                }
                """;

        CreateInvoiceRequest req = mapper.readValue(json, CreateInvoiceRequest.class);

        assertThat(req.sessionId()).isNull();
        assertThat(req.reservationSessionId()).isEqualTo("key-1");
    }

    @Test
    @DisplayName("with neither, there is no session to release")
    void noSessionAtAll() throws Exception {
        String json = """
                {"items": [{"inventoryId": "inv-1", "quantity": 2, "discount": 0}]}
                """;

        CreateInvoiceRequest req = mapper.readValue(json, CreateInvoiceRequest.class);

        assertThat(req.reservationSessionId()).isNull();
    }

    @Test
    @DisplayName("blank is treated as absent, not as a session named \"\"")
    void blankIsNotASession() throws Exception {
        String json = """
                {"idempotencyKey": "  ", "sessionId": "", "items": []}
                """;

        assertThat(mapper.readValue(json, CreateInvoiceRequest.class).reservationSessionId()).isNull();
    }

    @Test
    @DisplayName("the rest of the body still binds — the overload changed nothing else")
    void bindsEverythingElse() throws Exception {
        String json = """
                {
                  "customerId": "cust-1",
                  "paymentMode": "CREDIT",
                  "paymentStatus": "PENDING",
                  "isInterstate": true,
                  "billDiscountPct": 5,
                  "extraCharges": 20,
                  "adjustmentAmount": -1.5,
                  "items": [{"inventoryId": "inv-1", "quantity": 2, "freeQty": 1, "discount": 10}]
                }
                """;

        CreateInvoiceRequest req = mapper.readValue(json, CreateInvoiceRequest.class);

        assertThat(req.customerId()).isEqualTo("cust-1");
        assertThat(req.paymentModeOrDefault()).isEqualTo("CREDIT");
        assertThat(req.paymentStatusOrDefault()).isEqualTo("PENDING");
        assertThat(req.isInterstateOrDefault()).isTrue();
        assertThat(req.billDiscountPctOrZero()).isEqualByComparingTo("5");
        assertThat(req.extraChargesOrZero()).isEqualByComparingTo("20");
        assertThat(req.adjustmentAmountOrZero()).isEqualByComparingTo("-1.5");
        assertThat(req.items().get(0).freeQtyOrZero()).isEqualTo(1);
    }
}
