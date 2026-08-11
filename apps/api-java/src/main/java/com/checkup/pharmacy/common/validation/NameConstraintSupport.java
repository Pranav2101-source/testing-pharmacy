package com.checkup.pharmacy.common.validation;

import jakarta.validation.ConstraintValidatorContext;

import java.util.regex.Pattern;

/**
 * The body shared by {@link PersonNameValidator} and {@link ProfessionalNameValidator}.
 *
 * <p>The two differ only in which characters they permit; the order the complaints
 * are made in is the part worth keeping identical. Length, then digits, then shape —
 * so a name with a stray "2" is told about the "2" rather than being handed a list of
 * allowed punctuation to hunt through.
 */
final class NameConstraintSupport {

    private NameConstraintSupport() {
    }

    static boolean validate(String value, int max, Pattern pattern,
                            String digitsMessage, String patternMessage,
                            ConstraintValidatorContext context) {
        // Presence is @NotBlank's job. Reporting "is required" from here as well would
        // show the same field twice in one error response.
        if (value == null || value.isBlank()) return true;

        String name = ValidationPatterns.normalizeName(value);

        if (name.length() > max) {
            return fail(context, "cannot be longer than " + max + " characters");
        }
        if (ValidationPatterns.CONTAINS_DIGIT.matcher(name).find()) {
            return fail(context, digitsMessage);
        }
        if (!pattern.matcher(name).matches()) {
            return fail(context, patternMessage);
        }
        return true;
    }

    private static boolean fail(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
        return false;
    }
}
