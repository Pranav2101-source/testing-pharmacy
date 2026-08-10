package com.checkup.pharmacy.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Backs {@link ValidEmail}.
 *
 * <p>Names the half that is wrong rather than returning one catch-all. "must be a
 * valid email address" in front of {@code asha@gmail} sends the reader hunting for a
 * typo that isn't there; "needs a complete domain after @" points at the missing
 * {@code .com}. {@code GlobalExceptionHandler} prefixes the field name, so these read
 * as "email: needs a complete domain after @, e.g. gmail.com".
 *
 * <p>Kept in step with {@code validateEmail} in {@code packages/utils/src/validation.ts}
 * — same split, same order of complaints.
 */
public class ValidEmailValidator implements ConstraintValidator<ValidEmail, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        // Presence is @NotBlank's job.
        if (value == null || value.isBlank()) return true;

        String email = value.trim();

        if (email.chars().anyMatch(Character::isWhitespace)) {
            return fail(context, "cannot contain spaces");
        }
        if (email.length() > ValidationPatterns.MAX_EMAIL_LENGTH) {
            return fail(context, "cannot be longer than " + ValidationPatterns.MAX_EMAIL_LENGTH + " characters");
        }

        // Split on the LAST @: the local part may legally contain one, and splitting on
        // the first would blame the domain for a local-part problem.
        int at = email.lastIndexOf('@');
        if (at <= 0) {
            return fail(context, "must be a valid email address, e.g. name@gmail.com");
        }

        String local = email.substring(0, at);
        String domain = email.substring(at + 1);

        if (local.length() > ValidationPatterns.MAX_EMAIL_LOCAL_LENGTH) {
            return fail(context, "the part before @ is too long");
        }
        if (!ValidationPatterns.EMAIL_LOCAL.matcher(local).matches()) {
            return fail(context, "the part before @ has an invalid character");
        }
        if (!ValidationPatterns.EMAIL_DOMAIN.matcher(domain).matches()) {
            return fail(context, "needs a complete domain after @, e.g. gmail.com");
        }
        return true;
    }

    private boolean fail(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
        return false;
    }
}
