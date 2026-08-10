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
 * The value must be a complete email address — a local part, an {@code @}, and a
 * domain that ends in a real TLD.
 *
 * <p>Use in place of Jakarta's {@code @Email}, which accepts {@code name@gmail} and
 * {@code a@b}: it is only checking that the string has the <em>shape</em> of an
 * address, and a staff account created against a domain that cannot receive mail is
 * an account whose password reset silently goes nowhere.
 *
 * <p>Says nothing about presence: null and blank pass, so pair it with
 * {@code @NotBlank} when the field is mandatory. That split keeps "you left this
 * empty" and "this is not an address" as two separate messages.
 *
 * <p>Deliberately NOT applied to login or forgot-password: tightening the rule on the
 * way IN would lock out an account whose address was accepted by the looser rule when
 * it was created. Those endpoints look up an existing row; only the endpoints that
 * write a new address enforce this.
 */
@Documented
@Constraint(validatedBy = ValidEmailValidator.class)
@Target({FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE})
@Retention(RUNTIME)
public @interface ValidEmail {

    String message() default "must be a valid email address, e.g. name@gmail.com";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
