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
        @JsonProperty("_count") PurchaseOrderCount count
) {
    public record PurchaseOrderCount(long purchaseOrders) {
    }

    public static SupplierResponse withPoCount(
            String id, String name, String gstin, String dlNumber, String phone, String email,
            String address, String city, String state, BigDecimal creditLimit, int creditDays,
            String paymentTerms, boolean isActive, long purchaseOrderCount) {
        return new SupplierResponse(id, name, gstin, dlNumber, phone, email, address, city, state,
                creditLimit, creditDays, paymentTerms, isActive, new PurchaseOrderCount(purchaseOrderCount));
    }
}
