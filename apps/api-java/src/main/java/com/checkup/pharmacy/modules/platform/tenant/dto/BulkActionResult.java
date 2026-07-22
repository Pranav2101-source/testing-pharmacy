package com.checkup.pharmacy.modules.platform.tenant.dto;

/** Result of a bulk tenant status change — how many rows were affected. */
public record BulkActionResult(long affected) {
}
