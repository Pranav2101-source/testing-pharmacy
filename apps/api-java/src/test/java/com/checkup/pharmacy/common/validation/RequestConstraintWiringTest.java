package com.checkup.pharmacy.common.validation;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.auth.dto.RegisterRequest;
import com.checkup.pharmacy.modules.customer.dto.CustomerRequest;
import com.checkup.pharmacy.modules.prescription.dto.CreatePrescriptionRequest;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionItemRequest;
import com.checkup.pharmacy.modules.staff.dto.CreateStaffRequest;
import com.checkup.pharmacy.modules.staff.dto.UpdateStaffRequest;
import com.checkup.pharmacy.modules.supplier.dto.SupplierRequest;
import com.checkup.pharmacy.modules.support.dto.CreateTicketRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * That the shared constraints are actually attached to the request records.
 *
 * <p>{@link FieldConstraintsTest} proves the rules are right; this proves they are
 * wired to the fields QA reported. The distinction matters because the module ITs
 * call services directly, where Bean Validation never runs — a constraint could be
 * deleted from a DTO and every one of those tests would still pass.
 *
 * <p>Each case is one line from the QA report.
 */
class RequestConstraintWiringTest {

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

    private Set<String> fieldsInError(Object request) {
        return validator.validate(request).stream()
                .map(ConstraintViolation::getPropertyPath)
                .map(Object::toString)
                .collect(Collectors.toSet());
    }

    // ── Registration ──────────────────────────────────────────────────────────

    private RegisterRequest register(String pharmacyName, String ownerName, String phone) {
        return new RegisterRequest(pharmacyName, ownerName, phone, "owner@pharmacy.test",
                "correct horse battery", null, null, null, null, null, null);
    }

    @Test
    @DisplayName("QA 1 — the owner's name cannot be digits")
    void ownerNameRejectsDigits() {
        assertThat(fieldsInError(register("Radhika Medical Hall", "123456", "9876543210")))
                .contains("ownerName");
        assertThat(fieldsInError(register("Radhika Medical Hall", "Radhika Sharma", "9876543210")))
                .isEmpty();
    }

    @Test
    @DisplayName("a pharmacy is a business, so its name may contain digits")
    void pharmacyNameStillAcceptsDigits() {
        // "24x7 Medicos" is a real shop name. Applying the person rule here would be a
        // worse bug than the one being fixed.
        assertThat(fieldsInError(register("24x7 Medicos", "Radhika Sharma", "9876543210"))).isEmpty();
    }

    // ── Customers ─────────────────────────────────────────────────────────────

    private CustomerRequest customer(String name, String phone) {
        return new CustomerRequest(name, phone, null, null, null, null, null,
                "REGISTERED", BigDecimal.ZERO, BigDecimal.ZERO, null, null, null);
    }

    @Test
    @DisplayName("QA 4 — a customer's name cannot contain digits")
    void customerNameRejectsDigits() {
        assertThat(fieldsInError(customer("Ram2", "9876543210"))).contains("name");
    }

    @Test
    @DisplayName("QA 2 — a customer's mobile cannot contain letters")
    void customerPhoneRejectsLetters() {
        assertThat(fieldsInError(customer("Ram Kumar", "98765abcde"))).contains("phone");
    }

    private CustomerRequest customerOfType(String phone, String customerType) {
        return new CustomerRequest("Ram Kumar", phone, null, null, null, null, null,
                customerType, BigDecimal.ZERO, BigDecimal.ZERO, null, null, null);
    }

    @Test
    @DisplayName("QA 3 — a customer's mobile is mandatory")
    void customerPhoneIsMandatory() {
        assertThat(fieldsInError(customer("Ram Kumar", null))).contains("phone");
        assertThat(fieldsInError(customer("Ram Kumar", ""))).contains("phone");
        assertThat(fieldsInError(customer("Ram Kumar", "9876543210"))).isEmpty();
    }

    @Test
    @DisplayName("...except for a walk-in, who often has no number to give")
    void walkInMayHaveNoPhone() {
        // Forcing one here produces worse data than an empty field: staff type
        // "0000000000" and the pharmacy ends up with a thousand customers sharing a
        // phone number.
        assertThat(fieldsInError(customerOfType(null, "WALK_IN"))).isEmpty();
        assertThat(fieldsInError(customerOfType("", "WALK_IN"))).isEmpty();
    }

    @Test
    @DisplayName("a walk-in's phone is still checked when one IS given")
    void walkInPhoneStillHasToBeAPhone() {
        assertThat(fieldsInError(customerOfType("abcd", "WALK_IN"))).contains("phone");
    }

    @ParameterizedTest
    @ValueSource(strings = {"REGISTERED", "CORPORATE", "CREDIT"})
    @DisplayName("every deliberately-registered customer type needs a number")
    void registeredTypesRequirePhone(String type) {
        assertThat(fieldsInError(customerOfType(null, type))).contains("phone");
    }

    @Test
    @DisplayName("a blank customerType means walk-in, matching the service default")
    void blankTypeIsTreatedAsWalkIn() {
        // CustomerService.parseCustomerType(raw, true) defaults to WALK_IN. If this
        // rule disagreed, the form and the API would differ on an unset field.
        assertThat(fieldsInError(customerOfType(null, null))).isEmpty();
        assertThat(fieldsInError(customerOfType(null, "   "))).isEmpty();
    }

    @Test
    @DisplayName("an unrecognised customerType takes the stricter reading")
    void unknownTypeStillRequiresPhone() {
        // The service rejects the value anyway; a typo must not waive the requirement.
        assertThat(fieldsInError(customerOfType(null, "WALKIN"))).contains("phone");
    }

    // ── Suppliers ─────────────────────────────────────────────────────────────

    private SupplierRequest supplier(String name, String phone, String email) {
        return new SupplierRequest(name, null, null, phone, email, null, null, null,
                BigDecimal.ZERO, 30, null);
    }

    @Test
    @DisplayName("QA 5 — a distributor's phone is checked, like the email beside it")
    void supplierPhoneAndEmailAreChecked() {
        assertThat(fieldsInError(supplier("Sun Pharma Distributors", "abcd", null))).contains("phone");
        assertThat(fieldsInError(supplier("Sun Pharma Distributors", "98765", null))).contains("phone");
        assertThat(fieldsInError(supplier("Sun Pharma Distributors", "9876543210", "not-an-email")))
                .contains("email");
    }

    @Test
    @DisplayName("a distributor's phone stays optional — some are reachable only by email")
    void supplierPhoneRemainsOptional() {
        assertThat(fieldsInError(supplier("Sun Pharma Distributors", null, null))).isEmpty();
    }

    @Test
    @DisplayName("a distributor is a business, so its name may contain digits")
    void supplierNameStillAcceptsDigits() {
        assertThat(fieldsInError(supplier("A-1 Pharma 24x7 Pvt Ltd", "9876543210", null))).isEmpty();
    }

    // ── Prescriptions ─────────────────────────────────────────────────────────

    private CreatePrescriptionRequest prescription(String patientName, String patientPhone) {
        return new CreatePrescriptionRequest(null, "Dr. Sharma (Ortho)", "REG-1", null,
                patientName, 40, patientPhone, null, Instant.now(), null, null,
                List.of(new PrescriptionItemRequest("Dolo 650", null, null, 10, null, null, null)),
                null);
    }

    @Test
    @DisplayName("QA 7 — a patient's name cannot contain digits")
    void patientNameRejectsDigits() {
        assertThat(fieldsInError(prescription("Ram 123", null))).contains("patientName");
        assertThat(fieldsInError(prescription("Ram Kumar", null))).isEmpty();
    }

    @Test
    @DisplayName("...but an annotation the counter actually writes is not a digit problem")
    void patientNameAllowsCounterAnnotations() {
        // Transcribed off a paper script, "(S/O Shyam)" is how two patients with the
        // same name are told apart. QA asked for numbers to be restricted, not for this
        // to be rejected — hence @ProfessionalName rather than the narrow person rule.
        assertThat(fieldsInError(prescription("Ram Kumar (S/O Shyam)", null))).isEmpty();
        assertThat(fieldsInError(prescription("Baby of Sunita", null))).isEmpty();
    }

    @Test
    void patientPhoneIsCheckedButOptional() {
        assertThat(fieldsInError(prescription("Ram Kumar", "abcd"))).contains("patientPhone");
        assertThat(fieldsInError(prescription("Ram Kumar", null))).isEmpty();
    }

    @Test
    @DisplayName("the doctor's name takes the wider professional rule")
    void doctorNameAllowsQualifications() {
        // Every fixture above uses "Dr. Sharma (Ortho)", so this passing is what
        // proves brackets survive — narrowing it to @PersonName would block bills.
        assertThat(fieldsInError(prescription("Ram Kumar", null))).isEmpty();
    }

    @Test
    @DisplayName("but a doctor's name still cannot carry a registration number")
    void doctorNameRejectsDigits() {
        var withDigits = new CreatePrescriptionRequest(null, "Dr Rao 12345", "REG-1", null,
                "Ram Kumar", 40, null, null, Instant.now(), null, null,
                List.of(new PrescriptionItemRequest("Dolo 650", null, null, 10, null, null, null)),
                null);
        assertThat(fieldsInError(withDigits)).contains("doctorName");
    }

    // ── Staff and support, migrated off their inline patterns ────────────────

    @Test
    @DisplayName("staff phones now accept a pasted +91 and reject a bad leading digit")
    void staffPhoneUsesTheSharedRule() {
        assertThat(fieldsInError(new CreateStaffRequest("Asha Menon", "asha@pharmacy.test",
                "+91 98765 43210", Role.CASHIER, "correct horse battery"))).isEmpty();
        assertThat(fieldsInError(new CreateStaffRequest("Asha Menon", "asha@pharmacy.test",
                "1234567890", Role.CASHIER, "correct horse battery"))).contains("phone");
        assertThat(fieldsInError(new UpdateStaffRequest("Asha Menon", "abcd", Role.CASHIER, true)))
                .contains("phone");
    }

    @Test
    @DisplayName("a support ticket's mobiles use the shared rule, and stay optional")
    void ticketMobilesUseTheSharedRule() {
        assertThat(fieldsInError(ticket("+91 98765 43210", ""))).isEmpty();
        assertThat(fieldsInError(ticket("9876543210", null))).isEmpty();
        assertThat(fieldsInError(ticket("1234567890", null))).contains("mobile");
        assertThat(fieldsInError(ticket("9876543210", "abcd"))).contains("altMobile");
    }

    private CreateTicketRequest ticket(String mobile, String altMobile) {
        return new CreateTicketRequest("cat-1", null, null, null, null, null, null, null, null,
                "The billing screen will not open after the update.", mobile, altMobile);
    }
}
