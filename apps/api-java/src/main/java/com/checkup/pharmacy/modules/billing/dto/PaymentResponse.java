package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record PaymentResponse(
        String id,
        BigDecimal amount,
        String paymentMode,
        String reference,
        String notes,
        Instant paidAt
) {
}
