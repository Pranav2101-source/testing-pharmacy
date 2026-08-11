package com.checkup.pharmacy.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Backs {@link PersonName}.
 *
 * <p>Builds the message from what is actually wrong rather than returning one
 * catch-all. "cannot contain numbers" points straight at the "2" in "Ram Kumar 2";
 * "can only contain letters, spaces, and . ' -" would leave the reader hunting.
 * {@code GlobalExceptionHandler} prefixes the field name, so these read as
 * "ownerName: cannot contain numbers".
 */
public class PersonNameValidator implements ConstraintValidator<PersonName, String> {

    private int max;
    private String defaultMessage;

    @Override
    public void initialize(PersonName annotation) {
        this.max = annotation.max();
        this.defaultMessage = annotation.message();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return NameConstraintSupport.validate(value, max, ValidationPatterns.PERSON_NAME,
                "cannot contain numbers", defaultMessage, context);
    }
}
