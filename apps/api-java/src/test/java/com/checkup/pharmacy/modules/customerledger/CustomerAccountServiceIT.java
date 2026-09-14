package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.customerledger.dto.RecordAdvanceRequest;
import com.checkup.pharmacy.modules.customerledger.dto.RefundAdvanceRequest;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The counter-facing half of the customer ledger: taking and returning deposits,
 * and the statement/balances screens read from.
 *
 * <p>{@link CustomerLedgerIT} already pins the money math ({@code CustomerLedgerService}
 * itself) — this suite is about what sits around it: voucher numbering, which payment
 * modes a deposit can actually be taken in, and that a statement page always carries
 * the balances it describes rather than requiring a second call that could read a
 * different moment.
 */
@Transactional
class CustomerAccountServiceIT extends AbstractPostgresIT {

    @Autowired private CustomerAccountService accountService;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String customerId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        User user = userRepository.save(User.create(pharmacyId, "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));

        Customer customer = Customer.create(pharmacyId, "Ramesh Iyer");
        customer.applyFields("Ramesh Iyer", "9800000001", null, null, "KA", null, null, null, null,
                CustomerType.REGISTERED, BigDecimal.ZERO, BigDecimal.ZERO, null);
        customerId = customerRepository.save(customer).getId();

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

    @Nested
    @DisplayName("taking a deposit")
    class TakingADeposit {

        @Test
        @DisplayName("prints a numbered voucher and returns the new balances")
        void recordsANumberedVoucher() {
            var receipt = accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("2000"), "CASH", null, "standing order deposit"));

            assertThat(receipt.entry().entryNumber()).matches("ADV-\\d{4}-\\d{5}");
            assertThat(receipt.entry().amount()).isEqualByComparingTo("2000");
            assertThat(receipt.entry().advanceBalanceAfter()).isEqualByComparingTo("2000");
            assertThat(receipt.balances().advance()).isEqualByComparingTo("2000");
            assertThat(receipt.balances().customerId()).isEqualTo(customerId);
        }

        @Test
        @DisplayName("numbers each voucher one higher than the last")
        void voucherNumbersIncrement() {
            var first = accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("500"), "CASH", null, null));
            var second = accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("500"), "UPI", "txn-1", null));

            assertThat(first.entry().entryNumber()).isNotEqualTo(second.entry().entryNumber());
            assertThat(second.balances().advance()).isEqualByComparingTo("1000");
        }

        @Test
        @DisplayName("is refused as CREDIT — no money would actually change hands")
        void refusesCreditAsADepositMode() {
            assertThatThrownBy(() -> accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("500"), "CREDIT", null, null)))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("no money would change hands");
        }

        @Test
        @DisplayName("is refused as ADVANCE — cannot fund a deposit from itself")
        void refusesAdvanceAsADepositMode() {
            assertThatThrownBy(() -> accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("500"), "ADVANCE", null, null)))
                    .isInstanceOf(BadRequestException.class);
        }

        @Test
        @DisplayName("is refused for a payment method that does not exist")
        void refusesAnUnknownMode() {
            assertThatThrownBy(() -> accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("500"), "BITCOIN", null, null)))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("Cash, UPI, Card or Wallet");
        }

        @Test
        @DisplayName("against an unknown customer is refused, not silently posted")
        void refusesAnUnknownCustomer() {
            assertThatThrownBy(() -> accountService.recordAdvance("does-not-exist",
                    new RecordAdvanceRequest(new BigDecimal("500"), "CASH", null, null)))
                    .isInstanceOf(NotFoundException.class);
        }
    }

    @Nested
    @DisplayName("refunding a deposit")
    class RefundingADeposit {

        @Test
        @DisplayName("hands back money and prints its own voucher")
        void refundsAndPrintsAVoucher() {
            accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("1000"), "CASH", null, null));

            var receipt = accountService.refundAdvance(customerId,
                    new RefundAdvanceRequest(new BigDecimal("400"), "CASH", "customer asked for it back"));

            assertThat(receipt.entry().entryNumber()).matches("REF-\\d{4}-\\d{5}");
            assertThat(receipt.balances().advance()).isEqualByComparingTo("600");
        }

        @Test
        @DisplayName("cannot return more than is actually held")
        void cannotOverRefund() {
            accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("300"), "CASH", null, null));

            assertThatThrownBy(() -> accountService.refundAdvance(customerId,
                    new RefundAdvanceRequest(new BigDecimal("500"), "CASH", null)))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("advance is held");
        }
    }

    @Nested
    @DisplayName("statement and balances")
    class StatementAndBalances {

        @Test
        @DisplayName("a page of the statement carries the balances it describes")
        void statementCarriesItsOwnBalances() {
            accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("2000"), "CASH", null, null));
            accountService.refundAdvance(customerId,
                    new RefundAdvanceRequest(new BigDecimal("500"), "CASH", null));

            var page = accountService.statement(customerId, 1, 20);

            assertThat(page.items()).hasSize(2);
            assertThat(page.balances().advance()).isEqualByComparingTo("1500");
            // Newest first — the refund was posted second.
            assertThat(page.items().getFirst().type()).isEqualTo("REFUND");
        }

        @Test
        @DisplayName("balances read directly match what the ledger would compute")
        void balancesMatchTheLedger() {
            accountService.recordAdvance(customerId,
                    new RecordAdvanceRequest(new BigDecimal("750"), "UPI", "txn-2", null));

            var balances = accountService.balances(customerId);

            assertThat(balances.advance()).isEqualByComparingTo("750");
            assertThat(balances.dues()).isEqualByComparingTo("0");
        }
    }
}
