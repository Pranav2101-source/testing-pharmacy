package com.checkup.pharmacy.modules.customer.dto;

import com.checkup.pharmacy.common.enums.CustomerType;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/** Backs {@link PhoneRequiredUnlessWalkIn}. */
public class PhoneRequiredUnlessWalkInValidator
        implements ConstraintValidator<PhoneRequiredUnlessWalkIn, CustomerRequest> {

    private String message;

    @Override
    public void initialize(PhoneRequiredUnlessWalkIn annotation) {
        this.message = annotation.message();
    }

    @Override
    public boolean isValid(CustomerRequest request, ConstraintValidatorContext context) {
        if (request == null) return true;

        String phone = request.phone();
        if (phone != null && !phone.isBlank()) return true;

        if (isWalkIn(request.customerType())) return true;

        // Report against `phone` rather than the whole object, so the message reads
        // "phone: Mobile number is required..." and lands on the field to fix.
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message)
                .addPropertyNode("phone")
                .addConstraintViolation();
        return false;
    }

    /**
     * Blank means walk-in, matching {@code CustomerService.parseCustomerType(raw, true)}.
     *
     * <p>An unrecognised value is treated as NOT walk-in — it is about to be rejected
     * by the service anyway, and the safe reading of an unknown type is the stricter
     * one. Reversing that would let a typo in `customerType` waive the requirement.
     */
    private boolean isWalkIn(String customerType) {
        if (customerType == null || customerType.isBlank()) return true;
        return CustomerType.WALK_IN.name().equals(customerType.trim());
    }
}
