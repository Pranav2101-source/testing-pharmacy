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
 * The value must look like a person's name — no digits, no symbols beyond the
 * punctuation names actually carry.
 *
 * <p>Says nothing about presence: null and blank pass, so pair it with
 * {@code @NotBlank} when the field is mandatory. That split keeps "you left this
 * empty" and "this is not a name" as two separate messages, which is what the person
 * filling in the form needs to hear.
 *
 * <p>Apply to people, never to businesses — see {@link ValidationPatterns#PERSON_NAME}.
 */
@Documented
@Constraint(validatedBy = PersonNameValidator.class)
@Target({FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE})
@Retention(RUNTIME)
public @interface PersonName {

    String message() default "can only contain letters, spaces, and . ' -";

    int max() default ValidationPatterns.MAX_PERSON_NAME_LENGTH;

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
