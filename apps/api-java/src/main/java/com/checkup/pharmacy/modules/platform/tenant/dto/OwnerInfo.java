package com.checkup.pharmacy.modules.platform.tenant.dto;

import com.checkup.pharmacy.modules.user.User;

/** The owner user of a tenant, as surfaced in platform tenant views. */
public record OwnerInfo(String name, String email, String phone) {

    public static OwnerInfo from(User u) {
        return u == null ? null : new OwnerInfo(u.getName(), u.getEmail(), u.getPhone());
    }
}
