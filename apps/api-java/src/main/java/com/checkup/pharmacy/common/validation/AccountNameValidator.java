package com.checkup.pharmacy.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Backs {@link AccountName}.
 *
 * <p>Does not share {@link NameConstraintSupport} with the other two: that helper's
 * order is length → digits → shape, and "digits are a failure" is exactly the rule
 * this constraint exists NOT to apply. It checks for the absence of letters instead.
 */
public class AccountNameValidator implements ConstraintValidator<AccountName, String> {

    private int max;
    private String defaultMessage;

    @Override
    public void initialize(AccountName annotation) {
        this.max = annotation.max();
        this.defaultMessage = annotation.message();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // Presence is @NotBlank's job.
        if (value == null || value.isBlank()) return true;

        String name = ValidationPatterns.normalizeName(value);

        if (name.length() > max) {
            return fail(context, "cannot be longer than " + max + " characters");
        }
        if (!ValidationPatterns.CONTAINS_LETTER.matcher(name).find()) {
            return fail(context, "must contain at least one letter");
        }
        if (!ValidationPatterns.ACCOUNT_NAME.matcher(name).matches()) {
            return fail(context, defaultMessage);
        }
        return true;
    }

    private boolean fail(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
        return false;
    }
}
