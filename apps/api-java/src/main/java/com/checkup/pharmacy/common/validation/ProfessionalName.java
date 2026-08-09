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
 * The value must look like a professional's name — {@link PersonName} widened to
 * allow the punctuation of a qualification.
 *
 * <p>For doctor fields. "Dr. Sharma (Ortho)" and "Dr. Rao MBBS/MS" are what
 * pharmacists actually type, so brackets, commas and slashes pass here; digits do
 * not, because a registration number has its own field.
 *
 * <p>Says nothing about presence: pair it with {@code @NotBlank} when mandatory.
 */
@Documented
@Constraint(validatedBy = ProfessionalNameValidator.class)
@Target({FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE})
@Retention(RUNTIME)
public @interface ProfessionalName {

    String message() default "can only contain letters, spaces, and . , ' - ( ) /";

    int max() default 200;

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
