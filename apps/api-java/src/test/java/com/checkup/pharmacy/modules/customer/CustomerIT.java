package com.checkup.pharmacy.modules.customer;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.customer.dto.CustomerRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Customer CRUD and the receivables (outstanding credit) report.
 */
@Transactional
class CustomerIT extends AbstractPostgresIT {

    @Autowired private CustomerService customerService;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        flushAndClear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private CustomerRequest request(String name, String cardNumber, BigDecimal creditLimit) {
        return new CustomerRequest(name, "9876543210", null, null, null, null, cardNumber,
                "CREDIT", BigDecimal.ZERO, creditLimit, null, null, null);
    }

    @Test
    @DisplayName("a created customer is retrievable and correctly scoped to this pharmacy")
    void createdCustomerIsRetrievable() {
        var created = customerService.create(request("Jane Doe", null, new BigDecimal("5000")));
        flushAndClear();

        var fetched = customerService.getById(created.id());
        assertThat(fetched.name()).isEqualTo("Jane Doe");
        assertThat(fetched.creditLimit()).isEqualByComparingTo(new BigDecimal("5000"));
    }

    @Test
    @DisplayName("two customers with the same card number in one pharmacy are rejected")
    void duplicateCardNumberRejected() {
        String card = "CARD-" + unique();
        customerService.create(request("First Customer", card, null));
        flushAndClear();

        assertThatThrownBy(() -> customerService.create(request("Second Customer", card, null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("the same card number is fine across two different pharmacies")
    void sameCardNumberAllowedAcrossPharmacies() {
        String card = "CARD-" + unique();
        customerService.create(request("First Customer", card, null));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        var created = customerService.create(request("Different Pharmacy Customer", card, null));
        assertThat(created.id()).isNotBlank();
    }

    @Test
    @DisplayName("updating a customer's card number to one already used by another customer is rejected")
    void updateToConflictingCardNumberRejected() {
        String cardA = "CARD-" + unique();
        String cardB = "CARD-" + unique();
        customerService.create(request("Customer A", cardA, null));
        var b = customerService.create(request("Customer B", cardB, null));
        flushAndClear();

        assertThatThrownBy(() -> customerService.update(b.id(), request("Customer B", cardA, null)))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("another pharmacy's customer is not visible")
    void cannotAccessAnotherPharmacysCustomer() {
        var created = customerService.create(request("Jane Doe", null, null));
        flushAndClear();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> customerService.getById(created.id()))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("a soft-deleted customer no longer appears in lookups")
    void softDeletedCustomerIsInvisible() {
        var created = customerService.create(request("Jane Doe", null, null));
        flushAndClear();

        customerService.softDelete(created.id());
        flushAndClear();

        assertThatThrownBy(() -> customerService.getById(created.id()))
                .isInstanceOf(NotFoundException.class);
    }

    /**
     * The gap this pins: findOutstanding() (the receivables/Dues report) filters
     * deletedAt IS NULL, same as every other read here. Deleting a customer who
     * still owes money does not forgive the debt — creditUsed is untouched — it
     * just stops the report from showing it. The money is still owed; the pharmacy
     * would simply stop being reminded to collect it.
     */
    @Test
    @DisplayName("a customer who still owes money cannot be deleted")
    void cannotDeleteCustomerWithOutstandingCredit() {
        var created = customerService.create(request("Debtor Customer", null, new BigDecimal("5000")));
        flushAndClear();

        Customer customer = customerRepository.findById(created.id()).orElseThrow();
        customer.adjustCreditUsed(new BigDecimal("1200"));
        customerRepository.save(customer);
        flushAndClear();

        assertThatThrownBy(() -> customerService.softDelete(created.id()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("owe");

        assertThat(customerRepository.findById(created.id()).orElseThrow().isDeleted())
                .as("a refused delete must not soft-delete the row")
                .isFalse();
    }

    @Test
    @DisplayName("a customer with a zero balance can be deleted normally")
    void customerWithZeroBalanceCanBeDeleted() {
        var created = customerService.create(request("Paid Up Customer", null, new BigDecimal("5000")));
        flushAndClear();

        customerService.softDelete(created.id());
        flushAndClear();

        assertThat(customerRepository.findById(created.id()).orElseThrow().isDeleted()).isTrue();
    }

    @Test
    @DisplayName("the outstanding report lists a customer's real credit used")
    void outstandingReportReflectsCreditUsed() {
        var created = customerService.create(request("Credit Customer", null, new BigDecimal("5000")));
        flushAndClear();
        Customer customer = customerRepository.findById(created.id()).orElseThrow();
        customer.adjustCreditUsed(new BigDecimal("750"));
        customerRepository.save(customer);
        flushAndClear();

        var outstanding = customerService.listOutstanding();

        assertThat(outstanding.customers()).anySatisfy(item -> {
            assertThat(item.id()).isEqualTo(created.id());
            assertThat(item.creditUsed()).isEqualByComparingTo(new BigDecimal("750"));
        });
    }

    @Test
    @DisplayName("a customer with zero credit used does not appear in the outstanding report")
    void zeroBalanceCustomerNotInOutstandingReport() {
        var created = customerService.create(request("No Balance Customer", null, new BigDecimal("5000")));
        flushAndClear();

        var outstanding = customerService.listOutstanding();

        assertThat(outstanding.customers()).noneSatisfy(item -> assertThat(item.id()).isEqualTo(created.id()));
    }
}
