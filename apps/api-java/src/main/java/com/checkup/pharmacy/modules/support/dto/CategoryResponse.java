package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.modules.support.TicketCategory;

public record CategoryResponse(String id, String name, boolean isActive, int sortOrder) {

    public static CategoryResponse from(TicketCategory c) {
        return new CategoryResponse(c.getId(), c.getName(), c.isActive(), c.getSortOrder());
    }
}
