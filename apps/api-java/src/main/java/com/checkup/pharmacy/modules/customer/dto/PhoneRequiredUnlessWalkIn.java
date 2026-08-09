package com.checkup.pharmacy.modules.customer.dto;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * A customer must carry a mobile number unless they are a walk-in.
 *
 * <p>QA asked for the mobile to be mandatory, and for a customer you are deliberately
 * registering — for credit, for a corporate account, for the loyalty card — it should
 * be: a record with no way to reach the person is the one thing the screen exists to
 * capture. A walk-in is the opposite case. Someone buying a strip of paracetamol over
 * the counter often has no number to give, and refusing to record the sale until one
 * is invented produces worse data than leaving the field empty: staff type "0000000000"
 * and the pharmacy ends up with a thousand customers sharing one phone number.
 *
 * <p>Class-level because the answer depends on two fields at once. The violation is
 * still reported against {@code phone}, so the frontend and the error message point at
 * the box the user has to fill in rather than at the object as a whole.
 *
 * <p>A blank customerType means WALK_IN — {@code CustomerService.parseCustomerType}
 * defaults it that way, and this must agree with it or the form and the API would
 * disagree about an unset field.
 */
@Documented
@Constraint(validatedBy = PhoneRequiredUnlessWalkInValidator.class)
@Target(TYPE)
@Retention(RUNTIME)
public @interface PhoneRequiredUnlessWalkIn {

    String message() default "Mobile number is required for a registered customer";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
