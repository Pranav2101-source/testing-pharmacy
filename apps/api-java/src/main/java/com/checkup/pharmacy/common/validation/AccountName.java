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
 * The value must look like an account label — a staff member, a till, a desk.
 *
 * <p>The widest of the three name rules. A pharmacy names its logins "Billing Counter
 * 2" and "Till 3", so unlike {@link PersonName} and {@link ProfessionalName} this one
 * cannot ban digits: doing so would reject the naming convention rather than the bad
 * data. What it does catch is the defect worth catching — a value with no letters in
 * it at all ("123456", "---"), which is never a name, only something typed to get
 * past the form.
 *
 * <p>If a pharmacy would rather hold staff names to the strict person rule, swapping
 * this for {@code @PersonName} is a one-line change on the DTO.
 *
 * <p>Says nothing about presence: pair it with {@code @NotBlank} when mandatory.
 */
@Documented
@Constraint(validatedBy = AccountNameValidator.class)
@Target({FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE})
@Retention(RUNTIME)
public @interface AccountName {

    String message() default "can only contain letters, numbers, spaces, and . , ' - ( ) / &";

    int max() default ValidationPatterns.MAX_PERSON_NAME_LENGTH;

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
