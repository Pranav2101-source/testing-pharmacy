package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.CustomerLedgerEntryType;
import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The customer khata: dues, advances, and the guarantee that the cached balances
 * on {@code Customer} never disagree with the ledger behind them.
 *
 * <p>Two of these tests pin behaviour that was provably broken before this ledger
 * existed, and the rest exist because a money balance with no history is
 * unrepairable once wrong:
 * <ul>
 *   <li>a PARTIAL payment now reduces what the customer owes — it previously moved
 *       {@code creditUsed} only on the transition to fully-PAID, so paying
 *       Rs.400 of a Rs.1000 bill left the customer still showing Rs.1000 owed;</li>
 *   <li>statement order is posting order — entries written by one bill share an
 *       {@code entryAt} to the millisecond (CURRENT_TIMESTAMP is transaction-start
 *       time), and ordering by it fell through to the cuid id, which is
 *       alphabetical, so a statement could print a sale after the payment that
 *       settled it.</li>
 * </ul>
 */
@Transactional
class CustomerLedgerIT extends AbstractPostgresIT {

    @Autowired private CustomerLedgerService ledgerService;
    @Autowired private CustomerLedgerEntryRepository ledgerRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String customerId;
    private String userId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        pharmacyId = pharmacy.getId();
        User user = userRepository.save(User.create(pharmacyId, "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        userId = user.getId();

        Customer customer = Customer.create(pharmacyId, "Lakshmi Rao");
        customer.applyFields("Lakshmi Rao", "9800000000", null, null, "KA", null, null, null, null,
                CustomerType.CREDIT, BigDecimal.ZERO, new BigDecimal("5000.00"), null);
        customerId = customerRepository.save(customer).getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private Customer reloadCustomer() {
        flushAndClear();
        return customerRepository.findById(customerId).orElseThrow();
    }

    private BigDecimal dues() {
        return reloadCustomer().getCreditUsed();
    }

    private BigDecimal advance() {
        return reloadCustomer().getAdvanceBalance();
    }

    // ── Dues ──────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("dues")
    class Dues {

        @Test
        @DisplayName("a credit sale puts its unpaid amount on the khata")
        void saleIncreasesDues() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);

            assertThat(dues()).isEqualByComparingTo("1000.00");
            assertThat(ledgerService.isReconciled(pharmacyId, customerId)).isTrue();
        }

        @Test
        @DisplayName("a PARTIAL payment reduces the dues immediately, not only on full settlement")
        void partialPaymentReducesDues() {
            // The regression this ledger was built for: creditUsed used to move only
            // when a bill flipped to fully PAID, so this Rs.400 was invisible and the
            // customer kept showing the full Rs.1000 outstanding.
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);
            ledgerService.postPayment(pharmacyId, customerId, null, new BigDecimal("400.00"),
                    PaymentMode.UPI, "RCPT-1", null, null, null, userId);

            assertThat(dues()).isEqualByComparingTo("600.00");
            assertThat(ledgerService.isReconciled(pharmacyId, customerId)).isTrue();
        }

        @Test
        @DisplayName("paying more than is owed is refused, and says to take the excess as an advance")
        void paymentCannotExceedDues() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("500.00"), userId);

            assertThatThrownBy(() -> ledgerService.postPayment(pharmacyId, customerId, null,
                    new BigDecimal("800.00"), PaymentMode.CASH, null, null, null, null, userId))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("advance");

            assertThat(dues()).isEqualByComparingTo("500.00");
        }

        @Test
        @DisplayName("a return against an unpaid bill reduces the dues")
        void returnCreditReducesDues() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);
            ledgerService.postReturnCredit(pharmacyId, customerId, null, null, new BigDecimal("250.00"), userId);

            assertThat(dues()).isEqualByComparingTo("750.00");
        }

        @Test
        @DisplayName("a write-off clears dues but demands a reason")
        void writeOffNeedsAReason() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("300.00"), userId);

            assertThatThrownBy(() -> ledgerService.postWriteOff(pharmacyId, customerId,
                    new BigDecimal("300.00"), null, "  ", userId))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("reason");

            ledgerService.postWriteOff(pharmacyId, customerId, new BigDecimal("300.00"), "WO-1",
                    "untraceable after 18 months", userId);
            assertThat(dues()).isEqualByComparingTo("0.00");
        }
    }

    // ── Advances ──────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("advances")
    class Advances {

        @Test
        @DisplayName("a deposit raises the advance held and leaves dues alone")
        void advanceDoesNotTouchDues() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("500.00"), userId);
            ledgerService.postAdvance(pharmacyId, customerId, new BigDecimal("2000.00"),
                    PaymentMode.CASH, "ADV-1", null, null, null, userId);

            // Deliberately NOT netted against the Rs.500 owed: the deposit receipt must
            // say Rs.2000, and settling dues from it is a separate visible act.
            assertThat(advance()).isEqualByComparingTo("2000.00");
            assertThat(dues()).isEqualByComparingTo("500.00");
        }

        @Test
        @DisplayName("applying an advance moves both balances in one entry")
        void applyAdvanceMovesBoth() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);
            ledgerService.postAdvance(pharmacyId, customerId, new BigDecimal("600.00"),
                    PaymentMode.CASH, "ADV-2", null, null, null, userId);
            ledgerService.applyAdvance(pharmacyId, customerId, null, new BigDecimal("600.00"), userId);

            assertThat(dues()).isEqualByComparingTo("400.00");
            assertThat(advance()).isEqualByComparingTo("0.00");
            assertThat(ledgerService.isReconciled(pharmacyId, customerId)).isTrue();
        }

        @Test
        @DisplayName("we cannot hand back advance we never held")
        void advanceCannotGoNegative() {
            ledgerService.postAdvance(pharmacyId, customerId, new BigDecimal("100.00"),
                    PaymentMode.CASH, "ADV-3", null, null, null, userId);

            assertThatThrownBy(() -> ledgerService.postRefund(pharmacyId, customerId,
                    new BigDecimal("250.00"), PaymentMode.CASH, "REF-1", "walked out", userId))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("advance is held");

            assertThat(advance()).isEqualByComparingTo("100.00");
        }
    }

    // ── Statement ordering (the entryAt collision bug) ────────────────────────

    @Nested
    @DisplayName("statement")
    class Statement {

        @Test
        @DisplayName("prints in posting order, not in id order")
        void statementOrderIsPostingOrder() {
            ledgerService.postAdvance(pharmacyId, customerId, new BigDecimal("2000.00"),
                    PaymentMode.CASH, "ADV-4", null, null, null, userId);
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("5000.00"), userId);
            ledgerService.applyAdvance(pharmacyId, customerId, null, new BigDecimal("2000.00"), userId);
            ledgerService.postPayment(pharmacyId, customerId, null, new BigDecimal("1200.00"),
                    PaymentMode.UPI, "RCPT-2", null, null, null, userId);
            flushAndClear();

            List<CustomerLedgerEntry> entries =
                    ledgerRepository.findStatementAscending(pharmacyId, customerId);

            assertThat(entries).extracting(CustomerLedgerEntry::getType).containsExactly(
                    CustomerLedgerEntryType.ADVANCE,
                    CustomerLedgerEntryType.SALE,
                    CustomerLedgerEntryType.ADVANCE_APPLIED,
                    CustomerLedgerEntryType.PAYMENT);
            assertThat(entries).extracting(CustomerLedgerEntry::getSeq).isSorted();
        }

        @Test
        @DisplayName("entries sharing one timestamp still print in posting order")
        void identicalTimestampsStillOrderCorrectly() {
            // The failure mode seq exists for. Entries written by one bill carry the
            // same instant — guaranteed for rows inserted with the DB's own
            // CURRENT_TIMESTAMP default, which is transaction-START time, and entirely
            // possible through the entity too since Instant.now() has finite
            // resolution. Forced explicitly here so the guarantee is actually tested:
            // ordering must NOT fall through to the cuid id, which is alphabetical and
            // would happily print the second receipt before the first.
            Instant sameMoment = Instant.parse("2026-09-12T10:00:00Z");
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);
            ledgerService.postPayment(pharmacyId, customerId, null, new BigDecimal("300.00"),
                    PaymentMode.CASH, "RCPT-A", null, null, sameMoment, userId);
            ledgerService.postPayment(pharmacyId, customerId, null, new BigDecimal("200.00"),
                    PaymentMode.UPI, "RCPT-B", null, null, sameMoment, userId);
            flushAndClear();

            List<CustomerLedgerEntry> entries =
                    ledgerRepository.findStatementAscending(pharmacyId, customerId);

            assertThat(entries).hasSize(3);
            assertThat(entries.get(1).getEntryAt()).isEqualTo(entries.get(2).getEntryAt());
            assertThat(entries).extracting(CustomerLedgerEntry::getEntryNumber)
                    .containsExactly(null, "RCPT-A", "RCPT-B");
            // And the closing balances still descend in the order the money arrived.
            assertThat(entries).extracting(CustomerLedgerEntry::getDuesBalanceAfter)
                    .containsExactly(new BigDecimal("1000.00"), new BigDecimal("700.00"),
                            new BigDecimal("500.00"));
        }

        @Test
        @DisplayName("each line's closing balance equals the running total before it")
        void runningBalancesAreConsistent() {
            ledgerService.postAdvance(pharmacyId, customerId, new BigDecimal("2000.00"),
                    PaymentMode.CASH, "ADV-5", null, null, null, userId);
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("5000.00"), userId);
            ledgerService.applyAdvance(pharmacyId, customerId, null, new BigDecimal("2000.00"), userId);
            ledgerService.postPayment(pharmacyId, customerId, null, new BigDecimal("1200.00"),
                    PaymentMode.UPI, "RCPT-3", null, null, null, userId);
            ledgerService.postReturnCredit(pharmacyId, customerId, null, null, new BigDecimal("800.00"), userId);
            flushAndClear();

            BigDecimal runningDues = BigDecimal.ZERO;
            BigDecimal runningAdvance = BigDecimal.ZERO;
            for (CustomerLedgerEntry e : ledgerRepository.findStatementAscending(pharmacyId, customerId)) {
                runningDues = runningDues.add(e.getDuesDelta());
                runningAdvance = runningAdvance.add(e.getAdvanceDelta());
                assertThat(e.getDuesBalanceAfter())
                        .as("dues after %s", e.getType())
                        .isEqualByComparingTo(runningDues);
                assertThat(e.getAdvanceBalanceAfter())
                        .as("advance after %s", e.getType())
                        .isEqualByComparingTo(runningAdvance);
            }

            // Rs.5000 billed, Rs.2000 from advance, Rs.1200 paid, Rs.800 returned.
            assertThat(runningDues).isEqualByComparingTo("1000.00");
            assertThat(dues()).isEqualByComparingTo("1000.00");
            assertThat(advance()).isEqualByComparingTo("0.00");
        }

        @Test
        @DisplayName("newest-first paging is the reverse of posting order")
        void pagedStatementIsNewestFirst() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("100.00"), userId);
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("200.00"), userId);
            flushAndClear();

            var page = ledgerRepository.findStatement(pharmacyId, customerId, PageRequest.of(0, 10));

            assertThat(page.getContent()).extracting(CustomerLedgerEntry::getAmount)
                    .containsExactly(new BigDecimal("200.00"), new BigDecimal("100.00"));
        }
    }

    // ── Reconciliation ────────────────────────────────────────────────────────

    @Nested
    @DisplayName("reconciliation")
    class Reconciliation {

        @Test
        @DisplayName("a tenant whose balances all came through the ledger reports no drift")
        void noDriftWhenAllWritesGoThroughTheLedger() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);
            ledgerService.postPayment(pharmacyId, customerId, null, new BigDecimal("400.00"),
                    PaymentMode.CASH, "RCPT-4", null, null, null, userId);
            flushAndClear();

            assertThat(ledgerService.findDrift(pharmacyId)).isEmpty();
        }

        @Test
        @DisplayName("a balance moved behind the ledger's back is caught")
        void driftIsDetected() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("1000.00"), userId);
            flushAndClear();

            // Exactly the pre-ledger failure mode: creditUsed nudged with no entry
            // behind it. Undetectable before; a report line now.
            Customer c = customerRepository.findById(customerId).orElseThrow();
            c.adjustCreditUsed(new BigDecimal("250.00"));
            customerRepository.save(c);
            flushAndClear();

            List<CustomerLedgerService.Drift> drift = ledgerService.findDrift(pharmacyId);

            assertThat(drift).hasSize(1);
            assertThat(drift.get(0).customerId()).isEqualTo(customerId);
            assertThat(drift.get(0).duesDrift()).isEqualByComparingTo("250.00");
            assertThat(ledgerService.isReconciled(pharmacyId, customerId)).isFalse();
        }

        @Test
        @DisplayName("cached dues with no ledger behind them at all are caught")
        void driftCatchesCustomerWithNoEntries() {
            Customer c = customerRepository.findById(customerId).orElseThrow();
            c.adjustCreditUsed(new BigDecimal("75.00"));
            customerRepository.save(c);
            flushAndClear();

            // A GROUP BY over the ledger alone would skip this customer entirely —
            // they have no rows to group. The outer join is what catches it.
            assertThat(ledgerService.findDrift(pharmacyId))
                    .extracting(CustomerLedgerService.Drift::customerId)
                    .containsExactly(customerId);
        }
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("guards")
    class Guards {

        @Test
        @DisplayName("an entry must move a positive amount — a negative one is refused, not absorbed")
        void rejectsZeroAndNegative() {
            assertThatThrownBy(() -> ledgerService.postSale(pharmacyId, customerId, null,
                    BigDecimal.ZERO, userId))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("positive");

            // Deliberately NOT normalised with abs(). A negative reaching here means the
            // caller computed a balance the wrong way round, and silently flipping the
            // sign would book a debt that may not exist at all.
            assertThatThrownBy(() -> ledgerService.postSale(pharmacyId, customerId, null,
                    new BigDecimal("-50.00"), userId))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("positive");

            assertThat(dues()).isEqualByComparingTo("0.00");
        }

        @Test
        @DisplayName("backfills the CURRENT cached balance without adding to it, and refuses a second run")
        void openingIsIdempotentByRefusal() {
            // Simulates the real pre-ledger state this method exists for: the cache
            // already holds a value from the old code path, with no ledger entry
            // behind it — exactly what the actual production backfill found (a
            // customer sitting at creditUsed=50 with zero ledger rows).
            Customer c = customerRepository.findById(customerId).orElseThrow();
            c.adjustCreditUsed(new BigDecimal("50.00"));
            customerRepository.save(c);
            flushAndClear();

            ledgerService.postOpening(pharmacyId, customerId, userId);
            flushAndClear();

            // The exact bug an earlier version of this method had: running the
            // opening amount through the normal write() path ADDS a delta to
            // whatever the cache already holds. Against this Rs.50, that would have
            // pushed it to Rs.100. The backfill must only explain the balance, never
            // move it.
            assertThat(dues()).isEqualByComparingTo("50.00");
            assertThat(ledgerService.isReconciled(pharmacyId, customerId)).isTrue();

            // Run twice, the backfill would double every historical balance in the
            // tenant — and because OPENING is the earliest entry it would read as a
            // genuine old debt rather than a bug.
            assertThatThrownBy(() -> ledgerService.postOpening(pharmacyId, customerId, userId))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("already");

            assertThat(dues()).isEqualByComparingTo("50.00");
        }

        @Test
        @DisplayName("a customer with nothing owed and no advance has nothing to backfill")
        void openingRefusesWhenNothingToBackfill() {
            assertThatThrownBy(() -> ledgerService.postOpening(pharmacyId, customerId, userId))
                    .isInstanceOf(BadRequestException.class)
                    .hasMessageContaining("Nothing to backfill");
        }

        @Test
        @DisplayName("a negative cached balance is refused, not silently backfilled")
        void openingCannotBeNegative() {
            Customer c = customerRepository.findById(customerId).orElseThrow();
            c.adjustCreditUsed(new BigDecimal("-10.00"));
            customerRepository.save(c);
            flushAndClear();

            assertThatThrownBy(() -> ledgerService.postOpening(pharmacyId, customerId, userId))
                    .isInstanceOf(BadRequestException.class);
        }

        @Test
        @DisplayName("posting against another tenant's customer finds nothing")
        void tenantScoped() {
            Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other", "ph-" + unique()));
            flushAndClear();

            assertThatThrownBy(() -> ledgerService.postSale(other.getId(), customerId, null,
                    new BigDecimal("100.00"), userId))
                    .isInstanceOf(NotFoundException.class);
        }

        @Test
        @DisplayName("credit available never reports negative headroom")
        void creditAvailableIsClamped() {
            ledgerService.postSale(pharmacyId, customerId, null, new BigDecimal("6000.00"), userId);
            flushAndClear();

            var balances = ledgerService.balances(pharmacyId, customerId);

            assertThat(balances.dues()).isEqualByComparingTo("6000.00");
            assertThat(balances.creditLimit()).isEqualByComparingTo("5000.00");
            assertThat(balances.creditAvailable()).isEqualByComparingTo("0.00");
        }
    }
}
