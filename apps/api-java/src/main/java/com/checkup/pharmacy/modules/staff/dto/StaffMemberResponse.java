package com.checkup.pharmacy.modules.staff.dto;

import java.time.Instant;

/** Matches the frontend's StaffMember shape exactly. */
public record StaffMemberResponse(
        String id,
        String name,
        String email,
        String phone,
        String role,
        boolean isActive,
        Instant lastLoginAt,
        Instant createdAt
) {
}
