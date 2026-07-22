package com.checkup.pharmacy.modules.support.dto;

import com.checkup.pharmacy.common.enums.TicketLanguage;
import com.checkup.pharmacy.common.enums.TicketPriority;
import com.checkup.pharmacy.common.enums.TicketSLA;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record CreateTicketRequest(
        @NotBlank(message = "Category required") String categoryId,
        @Size(max = 200) String customTitle,
        TicketLanguage language,
        TicketPriority priority,
        TicketSLA sla,
        Instant dueDate,
        /** Only meaningful when the caller is SUPPORT_AGENT/PLATFORM_ADMIN raising a ticket on a pharmacy's behalf. */
        String pharmacyId,
        AssignmentType assignmentType,
        String agentId,
        @NotBlank(message = "Description required")
        @Size(min = 10, max = 2000, message = "Description must be at least 10 characters") String description,
        @Pattern(regexp = "^[6-9]\\d{9}$|^$", message = "Enter a valid 10-digit mobile number") String mobile,
        @Pattern(regexp = "^[6-9]\\d{9}$|^$") String altMobile
) {
    public enum AssignmentType { UNASSIGNED, ROUND_ROBIN, MANUAL }
}
