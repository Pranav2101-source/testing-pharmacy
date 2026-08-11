package com.checkup.pharmacy.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Backs {@link IndianMobile}.
 *
 * <p>Reports length and leading-digit problems separately. Telling someone a
 * nine-digit number "must start with 6-9" when it already starts with 9 reads as a
 * broken form; telling them it is nine digits long tells them where to look.
 * {@code GlobalExceptionHandler} prefixes the field name, so these read as
 * "phone: must be exactly 10 digits".
 */
public class IndianMobileValidator implements ConstraintValidator<IndianMobile, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // Presence is @NotBlank's job.
        if (value == null || value.isBlank()) return true;

        String raw = value.trim();

        // Formatting characters are fine; letters are not. Checked before normalising,
        // because stripping non-digits first would silently turn "98765abcde" into a
        // five-digit number and report the wrong problem.
        if (raw.matches(".*[^\\d\\s+()\\-].*")) {
            return fail(context, "can only contain digits");
        }

        String digits = ValidationPatterns.normalizeMobile(raw);

        if (digits.length() != 10) {
            return fail(context, "must be exactly 10 digits");
        }
        if (!ValidationPatterns.INDIAN_MOBILE.matcher(digits).matches()) {
            return fail(context, "must start with 6, 7, 8 or 9");
        }
        return true;
    }

    private boolean fail(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
        return false;
    }
}
