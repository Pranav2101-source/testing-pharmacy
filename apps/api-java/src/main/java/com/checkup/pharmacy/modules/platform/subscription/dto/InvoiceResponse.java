package com.checkup.pharmacy.modules.platform.subscription.dto;

import com.checkup.pharmacy.modules.platform.domain.SubscriptionInvoice;

import java.time.Instant;

/** A subscription invoice, as returned by the detail's billing block and the invoices tab. */
public record InvoiceResponse(
        String id,
        String subscriptionId,
        String pharmacyId,
        String invoiceNumber,
        double amount,
        double tax,
        double discount,
        double total,
        String couponCode,
        String status,
        Instant dueDate,
        Instant paidAt,
        Instant createdAt) {

    public static InvoiceResponse from(SubscriptionInvoice i) {
        if (i == null) {
            return null;
        }
        return new InvoiceResponse(i.getId(), i.getSubscriptionId(), i.getPharmacyId(), i.getInvoiceNumber(),
                i.getAmount(), i.getTax(), i.getDiscount(), i.getTotal(), i.getCouponCode(),
                i.getStatus() == null ? null : i.getStatus().name(), i.getDueDate(), i.getPaidAt(), i.getCreatedAt());
    }
}
