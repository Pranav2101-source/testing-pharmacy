package com.checkup.pharmacy.modules.medicine.dto;

import jakarta.validation.constraints.Size;

/** {@code barcode} is user-supplied and lands on a unique index — cap its length defensively (EAN/UPC are ≤13; allow slack for custom codes). */
public record SetBarcodeRequest(@Size(max = 64, message = "Barcode cannot exceed 64 characters") String barcode) {
}
