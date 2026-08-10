package com.checkup.pharmacy.common.validation;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The shared {@link PersonName} and {@link IndianMobile} constraints.
 *
 * <p>These exist because a QA pass found that a customer could be saved with the name
 * "123456" and the phone "abcd" while the staff form three screens away rejected both.
 * The frontend now blocks the same values, but the API is reachable without it, so
 * these are the rules that actually hold.
 *
 * <p>The frontend copy of every case here lives in
 * {@code packages/utils/src/validation.test.ts} and must stay in agreement.
 */
class FieldConstraintsTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    private record NameHolder(@PersonName String name) {
    }

    private record MobileHolder(@IndianMobile String phone) {
    }

    private String nameError(String value) {
        return validator.validate(new NameHolder(value)).stream()
                .findFirst().map(v -> v.getMessage()).orElse(null);
    }

    private String mobileError(String value) {
        return validator.validate(new MobileHolder(value)).stream()
                .findFirst().map(v -> v.getMessage()).orElse(null);
    }

    private record EmailHolder(@ValidEmail String email) {
    }

    private String emailError(String value) {
        return validator.validate(new EmailHolder(value)).stream()
                .findFirst().map(v -> v.getMessage()).orElse(null);
    }

    @Nested
    @DisplayName("@ValidEmail")
    class Emails {

        @ParameterizedTest
        @ValueSource(strings = {
                "asha@gmail.com",
                "asha@yahoo.co.in",
                "contact@distributor.com",
                "a.b+c@sub.domain.co.in",
                "first.last@my-pharmacy.in",
                "TILL2@Gmail.COM",
        })
        @DisplayName("accepts the addresses people actually use")
        void acceptsOrdinaryAddresses(String email) {
            assertThat(emailError(email)).isNull();
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "asha@gmail",     // the reported case: no TLD
                "asha@gmail.",
                "asha@.com",
                "asha@a.b",       // 1-char TLD
                "asha@-gmail.com",
                "asha@gmail-.com",
                "asha",
                "@gmail.com",
                ".asha@gmail.com",
                "asha.@gmail.com",
                "as..ha@gmail.com",
        })
        @DisplayName("rejects what Jakarta's @Email let through")
        void rejectsIncompleteAddresses(String email) {
            assertThat(emailError(email)).isNotNull();
        }

        @Test
        @DisplayName("names the half that is wrong")
        void messagesPointAtTheProblem() {
            assertThat(emailError("asha@gmail")).isEqualTo("needs a complete domain after @, e.g. gmail.com");
            assertThat(emailError("as ha@gmail.com")).isEqualTo("cannot contain spaces");
            assertThat(emailError("a".repeat(65) + "@gmail.com")).isEqualTo("the part before @ is too long");
        }

        @Test
        @DisplayName("says nothing about presence — that is @NotBlank's job")
        void blankIsSomeoneElsesProblem() {
            assertThat(emailError(null)).isNull();
            assertThat(emailError("")).isNull();
            assertThat(emailError("   ")).isNull();
        }
    }

    @Nested
    @DisplayName("@PersonName")
    class PersonNames {

        @ParameterizedTest
        @ValueSource(strings = {"Ram Kumar", "Dr. K.S. Iyer", "O'Brien", "Ram-Kumar", "D'Souza", "Ann"})
        void acceptsThePunctuationRealNamesCarry(String name) {
            assertThat(nameError(name)).isNull();
        }

        @ParameterizedTest
        @ValueSource(strings = {"प्रणव", "प्रणव राज", "பிரணவ்", "রাহুল"})
        @DisplayName("accepts names written in Indian scripts")
        void acceptsIndianScripts(String name) {
            // Devanagari and Tamil compose vowels from combining marks. Without \p{M}
            // in the pattern every one of these is rejected — a far worse bug than the
            // one the rule was added to fix.
            assertThat(nameError(name)).isNull();
        }

        @Test
        void acceptsTheCurlyApostropheAWordProcessorProduces() {
            assertThat(nameError("O’Brien")).isNull();
        }

        @ParameterizedTest
        @ValueSource(strings = {"Ram2", "123456", "Ram Kumar 2", "2Ram"})
        void rejectsDigitsAndSaysSo(String name) {
            assertThat(nameError(name)).isEqualTo("cannot contain numbers");
        }

        @ParameterizedTest
        @ValueSource(strings = {"Ram@Kumar", "Ram_Kumar", "Ram/Kumar", ".Ram", "-Ram", "'"})
        void rejectsSymbolsThatAreNotNamePunctuation(String name) {
            assertThat(nameError(name)).isEqualTo("can only contain letters, spaces, and . ' -");
        }

        @Test
        @DisplayName("says nothing about presence — that is @NotBlank's job")
        void ignoresNullAndBlank() {
            // Reporting "is required" from here as well would show the same field
            // twice in one error response.
            assertThat(nameError(null)).isNull();
            assertThat(nameError("   ")).isNull();
        }

        @Test
        void enforcesTheLengthCap() {
            assertThat(nameError("a".repeat(101))).isEqualTo("cannot be longer than 100 characters");
            assertThat(nameError("a".repeat(100))).isNull();
        }
    }

    private record ProfessionalHolder(@ProfessionalName String name) {
    }

    private String professionalError(String value) {
        return validator.validate(new ProfessionalHolder(value)).stream()
                .findFirst().map(v -> v.getMessage()).orElse(null);
    }

    @Nested
    @DisplayName("@ProfessionalName")
    class ProfessionalNames {

        @ParameterizedTest
        @ValueSource(strings = {
                "Dr. Sharma (Ortho)", "Dr. Sharma, MD", "Dr. Rao MBBS/MS",
                "Dr. K.S. O'Brien-Rao", "Dr. Sharma (Ortho), MS",
        })
        @DisplayName("accepts the qualifications pharmacists actually type")
        void acceptsQualifications(String name) {
            assertThat(professionalError(name)).isNull();
        }

        @Test
        void stillRejectsDigitsAndSaysWhereTheyBelong() {
            assertThat(professionalError("Dr. Sharma 123"))
                    .isEqualTo("cannot contain numbers — put a registration number in its own field");
        }

        @ParameterizedTest
        @ValueSource(strings = {"Dr@Sharma", "<script>", "(Ortho) Dr. Sharma"})
        void rejectsSymbolsThatBelongToNoName(String name) {
            assertThat(professionalError(name)).isNotNull();
        }

        @Test
        @DisplayName("is wider than @PersonName, which must stay narrow")
        void doesNotWidenThePersonRule() {
            // If someone ever "simplifies" these into one pattern, this fails.
            assertThat(nameError("Dr. Sharma (Ortho)")).isNotNull();
            assertThat(professionalError("Dr. Sharma (Ortho)")).isNull();
        }
    }

    @Nested
    @DisplayName("@IndianMobile")
    class Mobiles {

        @ParameterizedTest
        @ValueSource(strings = {"9876543210", "6000000000", "7012345678", "8123456789"})
        void acceptsATenDigitMobile(String phone) {
            assertThat(mobileError(phone)).isNull();
        }

        @ParameterizedTest
        @ValueSource(strings = {"+91 98765 43210", "919876543210", "098765 43210", "+91-98765-43210", "(98765) 43210"})
        @DisplayName("tolerates the formats people paste")
        void toleratesPastedFormatting(String phone) {
            assertThat(mobileError(phone)).isNull();
        }

        @Test
        @DisplayName("reports letters distinctly from length")
        void reportsTheActualProblem() {
            // Stripping non-digits first would turn "98765abcde" into a five-digit
            // number and complain about its length instead of its letters.
            assertThat(mobileError("98765abcde")).isEqualTo("can only contain digits");
            assertThat(mobileError("98765")).isEqualTo("must be exactly 10 digits");
            assertThat(mobileError("98765432101")).isEqualTo("must be exactly 10 digits");
            assertThat(mobileError("1234567890")).isEqualTo("must start with 6, 7, 8 or 9");
        }

        @Test
        void ignoresNullAndBlank() {
            assertThat(mobileError(null)).isNull();
            assertThat(mobileError("  ")).isNull();
        }
    }

    @Nested
    @DisplayName("ValidationPatterns.normalizeMobile")
    class Normalisation {

        @Test
        void stripsCountryCodeTrunkZeroAndFormatting() {
            assertThat(ValidationPatterns.normalizeMobile("+91 98765 43210")).isEqualTo("9876543210");
            assertThat(ValidationPatterns.normalizeMobile("919876543210")).isEqualTo("9876543210");
            assertThat(ValidationPatterns.normalizeMobile("098765 43210")).isEqualTo("9876543210");
        }

        @Test
        @DisplayName("leaves a real number beginning 91 intact")
        void doesNotEatAValidNumberStartingWith91() {
            // The trap a bare startsWith("91") falls into: this IS a valid mobile, and
            // chopping it would store an 8-digit number nobody can call.
            assertThat(ValidationPatterns.normalizeMobile("9198765432")).isEqualTo("9198765432");
        }

        @Test
        void preservesNullSoPatchStillMeansLeaveUnchanged() {
            assertThat(ValidationPatterns.normalizeMobile(null)).isNull();
            assertThat(ValidationPatterns.normalizeName(null)).isNull();
        }

        @Test
        void collapsesWhitespaceInNames() {
            assertThat(ValidationPatterns.normalizeName("  Ram   Kumar  ")).isEqualTo("Ram Kumar");
        }
    }
}
