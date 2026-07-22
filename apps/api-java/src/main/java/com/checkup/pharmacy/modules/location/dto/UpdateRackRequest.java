package com.checkup.pharmacy.modules.location.dto;

/**
 * PATCH /locations/racks/{id} — every field optional. Used both for editing
 * details (code/name/aisle) and for the isActive toggle button; a null field is
 * left unchanged.
 */
public record UpdateRackRequest(String code, String name, String aisle, Boolean isActive) {
}
