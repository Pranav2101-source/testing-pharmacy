package com.checkup.pharmacy.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/** Backs {@link ProfessionalName}. See {@link NameConstraintSupport} for the shape. */
public class ProfessionalNameValidator implements ConstraintValidator<ProfessionalName, String> {

    private static final String DIGITS_MESSAGE =
            "cannot contain numbers — put a registration number in its own field";

    private int max;
    private String defaultMessage;

    @Override
    public void initialize(ProfessionalName annotation) {
        this.max = annotation.max();
        this.defaultMessage = annotation.message();
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return NameConstraintSupport.validate(value, max, ValidationPatterns.PROFESSIONAL_NAME,
                DIGITS_MESSAGE, defaultMessage, context);
    }
}
