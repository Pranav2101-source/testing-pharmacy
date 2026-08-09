package com.checkup.pharmacy.common.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.ANNOTATION_TYPE;
import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.RECORD_COMPONENT;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * The value must be an Indian mobile number — ten digits starting 6-9.
 *
 * <p>Common formatting is tolerated on the way in ("+91 98765 43210", "098765 43210")
 * because a pasted number is not a user error; it is normalised before the digits are
 * checked. Letters are not tolerated.
 *
 * <p>Says nothing about presence: null and blank pass, so pair it with
 * {@code @NotBlank} when the field is mandatory.
 */
@Documented
@Constraint(validatedBy = IndianMobileValidator.class)
@Target({FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE})
@Retention(RUNTIME)
public @interface IndianMobile {

    String message() default "must be a valid 10-digit mobile number";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
