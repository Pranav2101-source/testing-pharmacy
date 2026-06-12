// Fixed ID for the platform-level pharmacy that support staff belong to.
// Created by the support_module migration. Never reassigned.
export const PLATFORM_PHARMACY_ID = "platform_checkup_support";

export const SUPPORT_ROLES = ["SUPPORT_AGENT", "PLATFORM_ADMIN"] as const;
export type SupportRole = (typeof SUPPORT_ROLES)[number];

export const CATEGORY_OTHER_NAME = "Other";
