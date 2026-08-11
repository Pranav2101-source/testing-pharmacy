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
 * The value must look like a generic account label — a till, a desk, a shared login.
 *
 * <p>The widest of the three name rules: unlike {@link PersonName} and
 * {@link ProfessionalName} it permits digits, and only rejects a value with no letters
 * in it at all ("123456", "---"), which is never a name, only something typed to get
 * past the form.
 *
 * <p><strong>Nothing applies this today.</strong> It was on {@code CreateStaffRequest}
 * and {@code UpdateStaffRequest} to allow "Billing Counter 2" as a login name; QA
 * ruled that a staff member is a person and their name must read like one, so both
 * DTOs now carry {@code @PersonName}. Kept for a future non-person login — anything
 * adopting it should first check that a person's name is not what is really being
 * captured. Mirrors ACCOUNT_NAME_RE in {@code packages/utils/src/validation.ts}, which
 * is in the same state.
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
