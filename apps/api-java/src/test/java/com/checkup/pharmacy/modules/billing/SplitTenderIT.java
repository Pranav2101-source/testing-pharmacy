package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.PaymentStatus;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.billing.dto.AddPaymentRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest;
import com.checkup.pharmacy.modules.billing.dto.TenderRequest;
import com.checkup.pharmacy.modules.cashclosure.CashClosureService;
import com.checkup.pharmacy.modules.cashclosure.dto.CreateCashClosureRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.UpdateCashClosureRequest;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.customer.CustomerService;
import com.checkup.pharmacy.modules.customerledger.CustomerAccountService;
import com.checkup.pharmacy.modules.customerledger.dto.RecordAdvanceRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
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
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Bills settled more than one way at once.
 *
 * <p>The reason this is worth a suite of its own is that a single {@code paymentMode}
 * column used to be the whole record of how a bill was paid, and four separate things
 * were keyed off it: the day's drawer reconciliation, the credit-limit check, the dues
 * posted to the customer's ledger, and whether a bill could be cancelled. Splitting a
 * bill breaks the assumption behind all four at once, and each of them fails silently —
 * with a number that looks plausible — rather than by throwing.
 */
@Transactional
class SplitTenderIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private CashClosureService cashClosureService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private InvoiceRepository invoiceRepository;
    @Autowired private InvoicePaymentRepository paymentRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private CustomerAccountService accountService;
    @Autowired private CustomerService customerService;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12")));
        pharmacyId = pharmacy.getId();

        // MRP 100, so a sale of N units is a clean Rs.100N and every split below is
        // readable as whole rupees.
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 500,
                new BigDecimal("50.00"), new BigDecimal("100.00"), 10, 5)).getId();

        flushAndClear();
        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    @Nested
    @DisplayName("a bill split across two ways of paying")
    class SplitBill {

        @Test
        @DisplayName("records one payment row per leg, and is fully paid")
        void recordsEachLeg() {
            var response = billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("UPI", "600")));
            flushAndClear();

            var payments = paymentRepository.findByInvoiceIdOrderByPaidAtAsc(response.id());
            assertThat(payments).hasSize(2);
            assertThat(payments).extracting(p -> p.getPaymentMode().name())
                    .containsExactlyInAnyOrder("CASH", "UPI");
            assertThat(payments).extracting(InvoicePayment::getAmount)
                    .usingElementComparator(BigDecimal::compareTo)
                    .containsExactlyInAnyOrder(new BigDecimal("400"), new BigDecimal("600"));

            Invoice invoice = invoiceRepository.findById(response.id()).orElseThrow();
            assertThat(invoice.getAmountPaid()).isEqualByComparingTo(new BigDecimal("1000"));
            assertThat(invoice.balanceDue()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(invoice.getPaymentStatus()).isEqualTo(PaymentStatus.PAID);
        }

        @Test
        @DisplayName("is filed under its largest leg, so existing filters and badges still read")
        void isFiledUnderTheLargestLeg() {
            var response = billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("UPI", "600")));
            flushAndClear();

            assertThat(invoiceRepository.findById(response.id()).orElseThrow().getPaymentMode())
                    .isEqualTo(PaymentMode.UPI);
        }

        @Test
        @DisplayName("is refused when the legs do not add up, naming which way and by how much")
        void refusesLegsThatDoNotAddUp() {
            // The cashier has a customer waiting; "short by Rs.100" is actionable where
            // "they add up to 900 and the bill is 1000" is arithmetic homework.
            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("UPI", "500"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("Rs.100.00 short")
                    .hasMessageContaining("Rs.1000.00 bill");

            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("UPI", "700"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("Rs.100.00 more than");
        }

        @Test
        @DisplayName("is refused when a leg does not say how it was paid")
        void refusesALegWithNoMethod() {
            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    new TenderRequest("  ", new BigDecimal("1000"), null))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("does not say how it was paid");
        }

        @Test
        @DisplayName("is refused when a leg names something that is not a way of paying")
        void refusesAnUnknownMethod() {
            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    new TenderRequest("BITCOIN", new BigDecimal("1000"), null))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("is not a way this bill can be paid");
        }

        @Test
        @DisplayName("keeps the reference that proves a UPI or card leg")
        void keepsLegReferences() {
            var response = billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"),
                    new TenderRequest("UPI", new BigDecimal("600"), "UPI-TXN-99887766")));
            flushAndClear();

            assertThat(paymentRepository.findByInvoiceIdOrderByPaidAtAsc(response.id()))
                    .filteredOn(p -> p.getPaymentMode() == PaymentMode.UPI)
                    .singleElement()
                    .satisfies(p -> assertThat(p.getReference()).isEqualTo("UPI-TXN-99887766"));
        }

        @Test
        @DisplayName("is refused when the same way of paying is listed twice")
        void refusesDuplicateModes() {
            // Two CASH legs are the same rupees as far as every report can tell, and
            // they make "the largest leg" a coin flip.
            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("CASH", "600"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("two cash splits");
        }
    }

    @Nested
    @DisplayName("a bill part-paid and part on account")
    class PartlyOnAccount {

        @Test
        @DisplayName("owes only the credit leg, not the whole bill")
        void owesOnlyTheCreditLeg() {
            String customerId = creditCustomer(new BigDecimal("50000"));

            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            Invoice invoice = invoiceRepository.findById(response.id()).orElseThrow();
            assertThat(invoice.getPaymentStatus()).isEqualTo(PaymentStatus.PARTIAL);
            assertThat(invoice.getAmountPaid()).isEqualByComparingTo(new BigDecimal("600"));
            assertThat(invoice.balanceDue()).isEqualByComparingTo(new BigDecimal("400"));
            assertThat(customerRepository.findById(customerId).orElseThrow().getCreditUsed())
                    .as("the customer owes the Rs.400 put on account, not the Rs.1000 bill")
                    .isEqualByComparingTo(new BigDecimal("400"));
        }

        @Test
        @DisplayName("is refused when nobody is named to owe the credit leg")
        void refusesACreditLegWithNoCustomer() {
            // A debt has to be owed by somebody. This is the counter-sale case: no
            // customer on the bill, so there is no account to charge.
            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    tender("CASH", "600"), tender("CREDIT", "400"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("needs a customer to bill");
        }

        @Test
        @DisplayName("is refused when the customer is not set up for credit")
        void refusesACreditLegForACashCustomer() {
            Customer walkIn = customerRepository.save(Customer.create(pharmacyId, "Walk In"));
            flushAndClear();

            assertThatThrownBy(() -> billingService.createInvoice(sale(10, walkIn.getId(),
                    tender("CASH", "600"), tender("CREDIT", "400"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("not set up for credit");
        }

        @Test
        @DisplayName("writes no payment row for the credit leg — no money moved")
        void writesNoRowForTheCreditLeg() {
            String customerId = creditCustomer(new BigDecimal("50000"));

            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            assertThat(paymentRepository.findByInvoiceIdOrderByPaidAtAsc(response.id()))
                    .singleElement()
                    .satisfies(p -> assertThat(p.getPaymentMode()).isEqualTo(PaymentMode.CASH));
        }

        @Test
        @DisplayName("spends credit limit only on the credit leg")
        void limitIsChargedTheCreditLegOnly() {
            // Rs.500 of headroom against a Rs.1000 bill. Charging the limit for the whole
            // bill would refuse this sale, though the customer only ever owes Rs.400.
            String customerId = creditCustomer(new BigDecimal("500"));

            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            assertThat(invoiceRepository.findById(response.id()).orElseThrow().balanceDue())
                    .isEqualByComparingTo(new BigDecimal("400"));
        }

        @Test
        @DisplayName("still refuses a credit leg beyond the limit")
        void limitStillBites() {
            String customerId = creditCustomer(new BigDecimal("300"));

            assertThatThrownBy(() -> billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("Credit limit exceeded")
                    .hasMessageContaining("required: Rs.400");
        }

        @Test
        @DisplayName("clears its dues when the remainder is collected later")
        void collectingTheRemainderClearsDues() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            // The gate on this used to be `paymentMode == CREDIT`, and this bill is filed
            // under CASH — its larger leg. The customer's Rs.400 would have been taken
            // without ever clearing what they owed.
            billingService.addPayment(response.id(),
                    new AddPaymentRequest(new BigDecimal("400"), "CASH", null, null, null));
            flushAndClear();

            assertThat(customerRepository.findById(customerId).orElseThrow().getCreditUsed())
                    .isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(invoiceRepository.findById(response.id()).orElseThrow().getPaymentStatus())
                    .isEqualTo(PaymentStatus.PAID);
        }
    }

    @Nested
    @DisplayName("a bill settled from a customer's deposit")
    class SettlingFromAnAdvance {

        @Test
        @DisplayName("fully from the advance — PAID, dues untouched, advance drawn down by the bill")
        void fullySettledFromAdvance() {
            String customerId = customerWithAdvance("2000");

            var response = billingService.createInvoice(sale(10, customerId, tender("ADVANCE", "1000")));
            flushAndClear();

            Invoice invoice = invoiceRepository.findById(response.id()).orElseThrow();
            assertThat(invoice.getPaymentStatus()).isEqualTo(PaymentStatus.PAID);
            assertThat(invoice.getAmountPaid()).isEqualByComparingTo("1000");
            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .isEqualByComparingTo("1000");
            assertThat(customerRepository.findById(customerId).orElseThrow().getCreditUsed())
                    .as("an advance leg is money already held, not a new debt")
                    .isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("writes a real payment row, mode ADVANCE, stamped at checkout")
        void writesAPaymentRowInTheTenderedEra() {
            String customerId = customerWithAdvance("2000");

            var response = billingService.createInvoice(sale(10, customerId, tender("ADVANCE", "1000")));
            flushAndClear();

            Invoice invoice = invoiceRepository.findById(response.id()).orElseThrow();
            assertThat(paymentRepository.findByInvoiceIdOrderByPaidAtAsc(response.id()))
                    .singleElement()
                    .satisfies(p -> {
                        assertThat(p.getPaymentMode()).isEqualTo(PaymentMode.ADVANCE);
                        assertThat(p.getAmount()).isEqualByComparingTo("1000");
                        assertThat(p.getPaidAt()).isEqualTo(invoice.getCreatedAt());
                    });
        }

        @Test
        @DisplayName("partly from the advance, the rest in cash")
        void partlySettledFromAdvance() {
            String customerId = customerWithAdvance("300");

            var response = billingService.createInvoice(sale(10, customerId,
                    tender("ADVANCE", "300"), tender("CASH", "700")));
            flushAndClear();

            Invoice invoice = invoiceRepository.findById(response.id()).orElseThrow();
            assertThat(invoice.getPaymentStatus()).isEqualTo(PaymentStatus.PAID);
            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("is refused when it draws more than is actually held")
        void refusesDrawingMoreThanHeld() {
            String customerId = customerWithAdvance("400");

            assertThatThrownBy(() -> billingService.createInvoice(sale(10, customerId,
                    tender("ADVANCE", "1000"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("Only Rs.400.00")
                    .hasMessageContaining("held in advance");

            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .as("a refused sale must not have partially drawn the deposit")
                    .isEqualByComparingTo("400.00");
        }

        @Test
        @DisplayName("is refused with no customer — a deposit belongs to somebody")
        void refusesWithNoCustomer() {
            assertThatThrownBy(() -> billingService.createInvoice(sale(10, null,
                    tender("ADVANCE", "1000"))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("Paying from an advance needs a customer");
        }

        @Test
        @DisplayName("never lands in the day's credit-sold figure")
        void isNeverReportedAsCreditSold() {
            String customerId = customerWithAdvance("1000");
            billingService.createInvoice(sale(10, customerId, tender("ADVANCE", "1000")));
            flushAndClear();

            var closure = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, BigDecimal.ZERO, BigDecimal.ZERO, null));
            flushAndClear();

            assertThat(closure.creditSales())
                    .as("nothing was put on account — it was drawn from a deposit already held")
                    .isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("cancelling the bill gives the deposit back")
        void cancellingRestoresTheAdvance() {
            String customerId = customerWithAdvance("2000");
            var response = billingService.createInvoice(sale(10, customerId, tender("ADVANCE", "1000")));
            flushAndClear();
            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .isEqualByComparingTo("1000");

            billingService.cancelInvoice(response.id(), "billed the wrong item");
            flushAndClear();

            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .as("the deposit must not be swallowed by voiding the bill")
                    .isEqualByComparingTo("2000");
        }

        @Test
        @DisplayName("cancelling after the customer was removed names the amount and asks to restore them")
        void cancellingAfterCustomerDeletedRefusesWithAClearMessage() {
            String customerId = customerWithAdvance("1000");
            var response = billingService.createInvoice(sale(10, customerId, tender("ADVANCE", "1000")));
            flushAndClear();
            // The deposit is now fully spent, so the customer can be removed —
            // softDelete only blocks on a live balance.
            customerService.softDelete(customerId);
            flushAndClear();

            assertThatThrownBy(() -> billingService.cancelInvoice(response.id(), "changed my mind"))
                    .isInstanceOf(ConflictException.class)
                    .hasMessageContaining("Rs.1000")
                    .hasMessageContaining("removed");
        }
    }

    @Nested
    @DisplayName("a return that leaves the customer overpaid")
    class ReturnOverpaymentBecomesAnAdvance {

        @Test
        @DisplayName("credits exactly the excess as an advance — clears dues, refunds the rest as a deposit")
        void excessIsCreditedAsAnAdvance() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            // Rs.1000 bill: Rs.600 paid at the counter, Rs.400 on account. Dues = 400.
            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            String itemId = billingService.getInvoice(response.id()).items().getFirst().id();
            // 7 of the 10 units come back — Rs.700 of goods, more than the Rs.400 still owed.
            billingService.createReturn(response.id(), new CreateReturnRequest("wrong strength",
                    List.of(new ReturnItemRequest(itemId, 7, null)), null));
            flushAndClear();

            Customer customer = customerRepository.findById(customerId).orElseThrow();
            assertThat(customer.getCreditUsed())
                    .as("the Rs.400 owed is fully cleared by the return")
                    .isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(customer.getAdvanceBalance())
                    .as("the customer paid Rs.600 for goods worth Rs.300 kept — Rs.300 is credited back")
                    .isEqualByComparingTo("300");
        }

        @Test
        @DisplayName("a second partial return only credits what it newly overpays")
        void secondReturnCreditsOnlyTheIncrement() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();
            String itemId = billingService.getInvoice(response.id()).items().getFirst().id();

            // First return: 4 units (Rs.400) — clears dues to exactly zero, no overpayment yet.
            billingService.createReturn(response.id(), new CreateReturnRequest("first batch faulty",
                    List.of(new ReturnItemRequest(itemId, 4, null)), null));
            flushAndClear();
            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .isEqualByComparingTo(BigDecimal.ZERO);

            // Second return: 2 more units (Rs.200) — now genuinely overpaid.
            String secondItemId = billingService.getInvoice(response.id()).items().getFirst().id();
            billingService.createReturn(response.id(), new CreateReturnRequest("second batch also faulty",
                    List.of(new ReturnItemRequest(secondItemId, 2, null)), null));
            flushAndClear();

            assertThat(customerRepository.findById(customerId).orElseThrow().getAdvanceBalance())
                    .as("only the second return's Rs.200 is new overpayment — not stacked with the first")
                    .isEqualByComparingTo("200");
        }
    }

    @Nested
    @DisplayName("the day's cash drawer")
    class Drawer {

        @Test
        @DisplayName("counts a split bill's cash leg once, not its whole total")
        void countsTheCashLegOnce() {
            // The bug this guards: cash was read BOTH off the invoice (full total, for a
            // bill filed under CASH) and off the tender rows. A Rs.1000 bill of which only
            // Rs.400 was cash would have put Rs.1400 into a drawer holding Rs.400.
            billingService.createInvoice(sale(10, null, tender("CASH", "400"), tender("UPI", "600")));
            flushAndClear();

            var closure = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1400"), null));
            flushAndClear();

            assertThat(closure.cashSales()).isEqualByComparingTo(new BigDecimal("400"));
            assertThat(closure.upiSales()).isEqualByComparingTo(new BigDecimal("600"));
            assertThat(closure.variance())
                    .as("opening 1000 + 400 cash = 1400 counted, so the till balances")
                    .isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("still counts an ordinary single-mode bill exactly once")
        void countsAnUntenderedBillOnce() {
            // The both-eras guarantee: a bill stating no tenders is read off the invoice,
            // as it always was, and must not be double counted by the new path.
            cashSaleWithoutTenders(3);

            var closure = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1300"), null));
            flushAndClear();

            assertThat(closure.cashSales()).isEqualByComparingTo(new BigDecimal("300"));
            assertThat(closure.variance()).isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("reports the credit leg of a split bill as sold on account")
        void reportsTheCreditLeg() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            var closure = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, BigDecimal.ZERO, new BigDecimal("600"), null));
            flushAndClear();

            assertThat(closure.cashSales()).isEqualByComparingTo(new BigDecimal("600"));
            assertThat(closure.creditSales()).isEqualByComparingTo(new BigDecimal("400"));
        }

        @Test
        @DisplayName("forgets a cancelled bill's tenders")
        void dropsCancelledBills() {
            var response = billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("UPI", "600")));
            flushAndClear();
            billingService.cancelInvoice(response.id(), "billed the wrong item");
            flushAndClear();

            var closure = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1000"), null));
            flushAndClear();

            assertThat(closure.cashSales())
                    .as("the cash was handed back, so the drawer must not still expect it")
                    .isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(closure.variance()).isEqualByComparingTo(BigDecimal.ZERO);
        }
    }

    @Nested
    @DisplayName("cancelling")
    class Cancelling {

        @Test
        @DisplayName("is allowed on a bill whose only payments are its own checkout tenders")
        void allowsCancellingAFreshlyTenderedBill() {
            // Every bill now carries payment rows from the moment it is raised. The old
            // guard refused to cancel anything with money against it, which would have
            // made the most common correction on a till — void the mis-punched bill and
            // ring it again — impossible.
            var response = billingService.createInvoice(sale(10, null,
                    tender("CASH", "400"), tender("UPI", "600")));
            flushAndClear();

            billingService.cancelInvoice(response.id(), "billed the wrong item");
            flushAndClear();

            assertThat(invoiceRepository.findById(response.id()).orElseThrow().isCancelled()).isTrue();
        }

        @Test
        @DisplayName("is still refused once a customer has settled against the bill")
        void stillRefusesAfterALaterSettlement() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            var response = billingService.createInvoice(sale(10, customerId,
                    tender("CASH", "600"), tender("CREDIT", "400")));
            flushAndClear();

            billingService.addPayment(response.id(),
                    new AddPaymentRequest(new BigDecimal("400"), "CASH", null, null, Instant.now().plusSeconds(60)));
            flushAndClear();

            assertThatThrownBy(() -> billingService.cancelInvoice(response.id(), "changed my mind"))
                    .isInstanceOf(ConflictException.class)
                    .hasMessageContaining("collected against it");
        }
    }

    @Nested
    @DisplayName("bills raised before split tender existed")
    class LegacyBills {

        /**
         * The trap this feature closes, as it exists in already-saved data: a bill marked
         * unpaid while filed under CASH, which never posted dues to anyone's ledger.
         */
        private String legacyUnpaidCashBill(String customerId) {
            var response = billingService.createInvoice(new CreateInvoiceRequest(customerId, null, null, null, null,
                    null, "CASH", "PENDING", null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO, null))));
            flushAndClear();
            return response.id();
        }

        @Test
        @DisplayName("never post dues, however many times they are part-paid")
        void repeatedPaymentsNeverTouchTheLedger() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            String invoiceId = legacyUnpaidCashBill(customerId);

            // The second payment is the one that used to break. After the first, the bill
            // has money against it, and a predicate reading "part paid, so on account"
            // would start posting against dues this sale never created — either failing
            // outright or clearing an unrelated debt of the customer's.
            billingService.addPayment(invoiceId,
                    new AddPaymentRequest(new BigDecimal("300"), "CASH", null, null, Instant.now().plusSeconds(30)));
            flushAndClear();
            billingService.addPayment(invoiceId,
                    new AddPaymentRequest(new BigDecimal("300"), "CASH", null, null, Instant.now().plusSeconds(60)));
            flushAndClear();

            assertThat(customerRepository.findById(customerId).orElseThrow().getCreditUsed())
                    .as("this sale never put anything on the account, so nothing may come off it")
                    .isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("are not reclassified as credit sales once someone pays against them")
        void staySettledUnderTheirOwnModeAfterAPayment() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            String invoiceId = legacyUnpaidCashBill(customerId);

            var before = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, BigDecimal.ZERO, BigDecimal.ZERO, null));
            flushAndClear();
            assertThat(before.creditSales()).isEqualByComparingTo(BigDecimal.ZERO);

            billingService.addPayment(invoiceId,
                    new AddPaymentRequest(new BigDecimal("400"), "CASH", null, null, Instant.now().plusSeconds(30)));
            flushAndClear();

            // Recomputed for the same day — update() re-reads the day's takings, which is
            // the path a till takes when it revises a closure before closing it. A payment
            // arriving today must not rewrite what this bill was recorded as having sold
            // on credit when it was raised.
            var after = cashClosureService.update(before.id(),
                    new UpdateCashClosureRequest(BigDecimal.ZERO, BigDecimal.ZERO, null));
            flushAndClear();
            assertThat(after.creditSales()).isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("a credit sale paid at the counter is still reported, not dropped")
        void paidCreditSaleIsStillCounted() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            billingService.createInvoice(new CreateInvoiceRequest(customerId, null, null, null, null, null,
                    "CREDIT", "PAID", null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO, null))));
            flushAndClear();

            var closure = cashClosureService.initForDate(
                    new CreateCashClosureRequest(null, BigDecimal.ZERO, BigDecimal.ZERO, null));
            flushAndClear();

            // It belongs to neither "received by mode" nor "unpaid", and an earlier cut of
            // the two-era split excluded it from both — Rs.1000 of trade vanishing from
            // the closure, the dashboard and the payment-mix report at once.
            assertThat(closure.creditSales()).isEqualByComparingTo(new BigDecimal("1000"));
        }
    }

    @Nested
    @DisplayName("a settlement dated before the bill it settles")
    class BackdatedPayment {

        @Test
        @DisplayName("is refused, so it cannot pass itself off as a checkout tender")
        void isRefused() {
            String customerId = creditCustomer(new BigDecimal("50000"));
            var response = billingService.createInvoice(sale(10, customerId, tender("CREDIT", "1000")));
            flushAndClear();

            Invoice invoice = invoiceRepository.findById(response.id()).orElseThrow();
            assertThatThrownBy(() -> billingService.addPayment(response.id(),
                    new AddPaymentRequest(new BigDecimal("1000"), "CASH", null, null,
                            invoice.getCreatedAt().minusSeconds(1))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("cannot be dated before");
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static TenderRequest tender(String mode, String amount) {
        return new TenderRequest(mode, new BigDecimal(amount), null);
    }

    /** `units` x Rs.100, settled by the given legs. */
    private CreateInvoiceRequest sale(int units, String customerId, TenderRequest... tenders) {
        return new CreateInvoiceRequest(customerId, null, null, null, null, null, null, null, List.of(tenders),
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO, null)));
    }

    /** A bill that names a single mode and no tenders — what every client sent before. */
    private void cashSaleWithoutTenders(int units) {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID",
                null, null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO, null))));
        flushAndClear();
    }

    private String creditCustomer(BigDecimal limit) {
        Customer customer = customerRepository.save(Customer.create(pharmacyId, "Credit Co"));
        customer.applyFields("Credit Co", null, null, null, null, null, null, null, null,
                CustomerType.CREDIT, BigDecimal.ZERO, limit, null);
        customerRepository.save(customer);
        flushAndClear();
        return customer.getId();
    }

    /** An ordinary customer holding the given deposit, taken in cash. */
    private String customerWithAdvance(String deposit) {
        Customer customer = customerRepository.save(Customer.create(pharmacyId, "Depositor"));
        flushAndClear();
        accountService.recordAdvance(customer.getId(),
                new RecordAdvanceRequest(new BigDecimal(deposit), "CASH", null, null));
        flushAndClear();
        return customer.getId();
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
