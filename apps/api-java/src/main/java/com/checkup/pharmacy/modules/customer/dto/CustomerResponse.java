package com.checkup.pharmacy.modules.customer.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;

/** Matches the frontend's CustomerRecord (+ `_count.invoices` from the list page). */
public record CustomerResponse(
        String id,
        String name,
        String phone,
        String email,
        String customerType,
        BigDecimal defaultDiscount,
        BigDecimal creditLimit,
        BigDecimal creditUsed,
        /** Deposit held for this customer. Sent with every customer so the till can offer
         *  to spend it without a second round trip when one is selected. */
        BigDecimal advanceBalance,
        String abhaNumber,
        String cardNumber,
        String gender,
        Instant dateOfBirth,
        String address,
        String state,
        String notes,
        @JsonProperty("_count") InvoiceCount count
) {
    public record InvoiceCount(long invoices) {
    }

    public static CustomerResponse withInvoiceCount(
            String id, String name, String phone, String email, String customerType,
            BigDecimal defaultDiscount, BigDecimal creditLimit, BigDecimal creditUsed,
            BigDecimal advanceBalance, String abhaNumber, String cardNumber, String gender,
            Instant dateOfBirth, String address, String state, String notes, long invoiceCount) {
        return new CustomerResponse(id, name, phone, email, customerType, defaultDiscount, creditLimit,
                creditUsed, advanceBalance, abhaNumber, cardNumber, gender, dateOfBirth, address, state, notes,
                new InvoiceCount(invoiceCount));
    }
}
