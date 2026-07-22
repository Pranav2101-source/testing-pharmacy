package com.checkup.pharmacy.modules.migration.csv;

import java.math.BigDecimal;
import java.time.Instant;

public record ValidatedCustomerRow(String name, String phone, String email, String address, Instant dateOfBirth,
                                   String gender, BigDecimal creditLimit, BigDecimal openingDue, String abhaNumber,
                                   String cardNumber, String notes) {
}
