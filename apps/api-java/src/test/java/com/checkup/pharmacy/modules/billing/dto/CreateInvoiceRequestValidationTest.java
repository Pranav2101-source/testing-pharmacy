package com.checkup.pharmacy.modules.billing.dto;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The request contract for creating an invoice.
 *
 * <p>Worth testing separately from the service because these constraints are the only
 * thing standing between a mistyped number and a committed financial document —
 * BillingService trusts the DTO and does not re-check ranges. The controller applies
 * them via {@code @Valid}, so a constraint that is missing here is simply not enforced
 * anywhere.
 */
class CreateInvoiceRequestValidationTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    private static CreateInvoiceRequest withBillDiscount(BigDecimal pct) {
        return new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                pct, null, null, null, null,
                List.of(new InvoiceItemRequest("inv-1", 1, null, BigDecimal.ZERO, null)));
    }

    private static boolean violates(CreateInvoiceRequest request, String field) {
        return validator.validate(request).stream()
                .anyMatch(v -> v.getPropertyPath().toString().startsWith(field));
    }

    /**
     * The case this constraint was added for: a bill-level discount of 100 where 10 was
     * meant. Unbounded, that produced a zero-rupee invoice while the stock still left
     * the shelf, because the total is clamped at zero rather than going negative.
     */
    @ParameterizedTest(name = "billDiscountPct = {0} is rejected")
    @ValueSource(strings = {"100.01", "150", "1000", "-0.01", "-10"})
    @DisplayName("a bill discount outside 0-100 is rejected")
    void rejectsOutOfRangeBillDiscount(String pct) {
        assertThat(violates(withBillDiscount(new BigDecimal(pct)), "billDiscountPct")).isTrue();
    }

    @ParameterizedTest(name = "billDiscountPct = {0} is accepted")
    @ValueSource(strings = {"0", "10", "99.99", "100"})
    @DisplayName("the full 0-100 range remains usable, boundaries included")
    void acceptsInRangeBillDiscount(String pct) {
        assertThat(violates(withBillDiscount(new BigDecimal(pct)), "billDiscountPct")).isFalse();
    }

    @Test
    @DisplayName("an omitted bill discount is still valid — the field is optional")
    void allowsNullBillDiscount() {
        assertThat(violates(withBillDiscount(null), "billDiscountPct")).isFalse();
    }

    @Test
    @DisplayName("a negative extra charge is rejected — it would bypass the discount cap")
    void rejectsNegativeExtraCharges() {
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                null, new BigDecimal("-500"), null, null, null,
                List.of(new InvoiceItemRequest("inv-1", 1, null, BigDecimal.ZERO, null)));

        assertThat(violates(request, "extraCharges")).isTrue();
    }

    /**
     * adjustmentAmount stays signed on purpose — it is the round-off/goodwill tweak.
     * The protection against an outsized negative one is in BillingService, which
     * refuses any bill whose total lands below zero.
     */
    @Test
    @DisplayName("a negative adjustment is accepted here — it is bounded in the service, not the DTO")
    void allowsNegativeAdjustmentAmount() {
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                null, null, new BigDecimal("-5"), null, null,
                List.of(new InvoiceItemRequest("inv-1", 1, null, BigDecimal.ZERO, null)));

        assertThat(violates(request, "adjustmentAmount")).isFalse();
    }

    @Test
    @DisplayName("an invoice with no line items is rejected")
    void rejectsEmptyItems() {
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, List.of());

        assertThat(violates(request, "items")).isTrue();
    }

    @Test
    @DisplayName("line-item constraints are enforced through the nested @Valid")
    void enforcesNestedItemConstraints() {
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null,
                // quantity 0 violates @Positive; discount 101 violates @Max(100).
                List.of(new InvoiceItemRequest("inv-1", 0, null, new BigDecimal("101"), null)));

        var violations = validator.validate(request);
        assertThat(violations).hasSizeGreaterThanOrEqualTo(2);
        assertThat(violations).anyMatch(v -> v.getPropertyPath().toString().contains("quantity"));
        assertThat(violations).anyMatch(v -> v.getPropertyPath().toString().contains("discount"));
    }
}
