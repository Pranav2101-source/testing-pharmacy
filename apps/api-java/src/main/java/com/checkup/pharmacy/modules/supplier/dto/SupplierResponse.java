package com.checkup.pharmacy.modules.supplier.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/** Matches the frontend's Supplier shape. */
public record SupplierResponse(
        String id,
        String name,
        String gstin,
        String dlNumber,
        String phone,
        String email,
        String address,
        String city,
        String state,
        BigDecimal creditLimit,
        int creditDays,
        String paymentTerms,
        boolean isActive,
        /**
         * What this pharmacy still owes the supplier; negative means the supplier owes us.
         * The Distributors tab renders this as the "Outstanding" figure and its type declares
         * it non-nullable, so it is never omitted — a supplier with no ledger activity sends
         * 0, not null, or the tab silently renders every balance as empty.
         */
        BigDecimal ledgerBalance,
        @JsonProperty("_count") PurchaseOrderCount count
) {
    public record PurchaseOrderCount(long purchaseOrders) {
    }

    public static SupplierResponse withPoCount(
            String id, String name, String gstin, String dlNumber, String phone, String email,
            String address, String city, String state, BigDecimal creditLimit, int creditDays,
            String paymentTerms, boolean isActive, BigDecimal ledgerBalance, long purchaseOrderCount) {
        return new SupplierResponse(id, name, gstin, dlNumber, phone, email, address, city, state,
                creditLimit, creditDays, paymentTerms, isActive,
                ledgerBalance == null ? BigDecimal.ZERO : ledgerBalance,
                new PurchaseOrderCount(purchaseOrderCount));
    }
}
