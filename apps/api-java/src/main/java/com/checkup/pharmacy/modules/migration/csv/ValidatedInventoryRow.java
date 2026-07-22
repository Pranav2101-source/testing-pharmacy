package com.checkup.pharmacy.modules.migration.csv;

import java.math.BigDecimal;
import java.time.Instant;

public record ValidatedInventoryRow(String medicineName, String batchNumber, Instant expiryDate, int quantity,
                                    BigDecimal mrp, BigDecimal purchaseRate, BigDecimal gstRate, String manufacturer,
                                    String hsnCode, Integer minimumStock) {
}
