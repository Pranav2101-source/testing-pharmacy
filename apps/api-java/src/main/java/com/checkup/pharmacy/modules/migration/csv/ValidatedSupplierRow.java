package com.checkup.pharmacy.modules.migration.csv;

import java.math.BigDecimal;

public record ValidatedSupplierRow(String name, String gstin, String dlNumber, String phone, String email,
                                   String address, String city, String state, Integer creditDays,
                                   BigDecimal openingBalance) {
}
