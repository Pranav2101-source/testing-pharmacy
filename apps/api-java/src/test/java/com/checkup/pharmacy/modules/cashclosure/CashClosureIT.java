package com.checkup.pharmacy.modules.cashclosure;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.AddPaymentRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.CloseCashClosureRequest;
import com.checkup.pharmacy.modules.cashclosure.dto.CreateCashClosureRequest;
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
 * End-of-day till reconciliation.
 *
 * <p>The number under test is always the same one: variance — physical cash counted
 * minus what the system believes should be in the drawer. It is the figure a pharmacy
 * owner uses to decide whether money went missing, so a systematic error here does not
 * merely misreport, it accuses staff.
 */
@Transactional
class CashClosureIT extends AbstractPostgresIT {

    @Autowired private CashClosureService cashClosureService;
    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private CustomerRepository customerRepository;
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

        // MRP 100 so a sale of 1 unit is a clean Rs.100 of cash.
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicine.getId(), "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("50.00"), new BigDecimal("100.00"), 10, 5)).getId();

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

    /** A customer set up to buy on credit, with headroom. */
    private String creditCustomer() {
        var customer = customerRepository.save(
                com.checkup.pharmacy.modules.customer.Customer.create(pharmacyId, "Credit Co"));
        customer.applyFields("Credit Co", null, null, null, null, null, null, null, null,
                com.checkup.pharmacy.common.enums.CustomerType.CREDIT, BigDecimal.ZERO,
                new BigDecimal("50000"), null);
        customerRepository.save(customer);
        flushAndClear();
        return customer.getId();
    }

    /** One cash sale of `units` x Rs.100. */
    private void cashSale(int units) {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID",
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO, null))));
        flushAndClear();
    }

    @Test
    @DisplayName("a closure opened after the day's trading counts that day's cash sales")
    void countsCashSalesMadeBeforeOpening() {
        cashSale(3); // Rs.300 in the drawer

        var closure = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1300"), null));
        flushAndClear();

        assertThat(closure.cashSales()).isEqualByComparingTo(new BigDecimal("300"));
        assertThat(closure.expectedCash()).isEqualByComparingTo(new BigDecimal("1300"));
        assertThat(closure.variance())
                .as("opening 1000 + 300 sales = 1300 counted, so the till balances")
                .isEqualByComparingTo(BigDecimal.ZERO);
    }

    /**
     * The ordering that breaks it.
     *
     * <p>{@code initForDate} snapshots the day's cash sales at the moment the closure
     * row is created, and {@code close} then reconciles against that stored snapshot
     * rather than re-reading. A pharmacy that opens the closure at the start of a shift
     * — or simply before the last customer — reconciles against a stale sales figure,
     * and every sale made in between shows up as unexplained surplus cash.
     */
    @Test
    @DisplayName("closing counts sales made after the closure was opened")
    void countsCashSalesMadeAfterOpening() {
        var opened = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, new BigDecimal("1000"), BigDecimal.ZERO, null));
        flushAndClear();
        assertThat(opened.cashSales()).isEqualByComparingTo(BigDecimal.ZERO);

        cashSale(2); // Rs.200 taken after the closure form was opened

        var closed = cashClosureService.close(opened.id(),
                new CloseCashClosureRequest(new BigDecimal("1200"), null));
        flushAndClear();

        assertThat(closed.cashSales())
                .as("the day's sales must be as at closing, not as at opening")
                .isEqualByComparingTo(new BigDecimal("200"));
        assertThat(closed.variance())
                .as("1000 opening + 200 sales = 1200 counted; the till balances and no one is short")
                .isEqualByComparingTo(BigDecimal.ZERO);
    }

    /**
     * A customer paying down a credit account hands over real cash today, against an
     * invoice raised on some earlier day.
     *
     * <p>Counting only invoices missed it entirely — the parent invoice is reported
     * under `creditSales` on its own date — so the money sat in the drawer with
     * nothing in the system to explain it, and the closure reported a surplus.
     */
    @Test
    @DisplayName("cash collected against a credit invoice counts toward today's cash")
    void creditSettlementCountsAsCash() {
        String creditCustomerId = creditCustomer();

        var creditInvoice = billingService.createInvoice(new CreateInvoiceRequest(creditCustomerId, null, null, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 4, null, BigDecimal.ZERO, null))));
        flushAndClear();

        // The customer comes back and settles Rs.400 in cash.
        billingService.addPayment(creditInvoice.id(),
                new AddPaymentRequest(new BigDecimal("400"), "CASH", null, null, Instant.now()));
        flushAndClear();

        var closure = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1400"), null));
        flushAndClear();

        assertThat(closure.cashSales())
                .as("Rs.400 of real cash entered the drawer today")
                .isEqualByComparingTo(new BigDecimal("400"));
        assertThat(closure.variance())
                .as("1000 opening + 400 collected = 1400 counted; the drawer matches")
                .isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("an unpaid credit sale puts no cash in the drawer")
    void unpaidCreditSaleIsNotCash() {
        String creditCustomerId = creditCustomer();

        billingService.createInvoice(new CreateInvoiceRequest(creditCustomerId, null, null, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 4, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var closure = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1000"), null));
        flushAndClear();

        assertThat(closure.cashSales())
                .as("goods left on credit; no money changed hands")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(closure.creditSales())
                .as("but it is still a credit sale made today")
                .isGreaterThan(BigDecimal.ZERO);
        assertThat(closure.variance()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("a genuine shortfall is reported as a negative variance")
    void shortfallIsNegativeVariance() {
        cashSale(5); // Rs.500 expected

        var closure = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1450"), null));
        flushAndClear();

        assertThat(closure.variance())
                .as("Rs.50 missing from the drawer")
                .isEqualByComparingTo(new BigDecimal("-50"));
    }

    @Test
    @DisplayName("a cancelled invoice is excluded from the day's takings")
    void cancelledInvoicesDoNotCount() {
        var invoice = billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PENDING",
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, null, BigDecimal.ZERO, null))));
        flushAndClear();
        billingService.cancelInvoice(invoice.id(), "entered by mistake");
        flushAndClear();

        var closure = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, new BigDecimal("1000"), new BigDecimal("1000"), null));
        flushAndClear();

        assertThat(closure.cashSales()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(closure.variance()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("only one closure may exist per pharmacy per day")
    void oneClosurePerDay() {
        cashClosureService.initForDate(new CreateCashClosureRequest(null, BigDecimal.ZERO, BigDecimal.ZERO, null));
        flushAndClear();

        assertThatThrownBy(() -> cashClosureService.initForDate(
                new CreateCashClosureRequest(null, BigDecimal.ZERO, BigDecimal.ZERO, null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("already exists");
    }

    @Test
    @DisplayName("a closed till cannot be closed or edited again")
    void closedTillIsFinal() {
        var opened = cashClosureService.initForDate(
                new CreateCashClosureRequest(null, BigDecimal.ZERO, BigDecimal.ZERO, null));
        flushAndClear();
        cashClosureService.close(opened.id(), new CloseCashClosureRequest(BigDecimal.ZERO, null));
        flushAndClear();

        assertThatThrownBy(() -> cashClosureService.close(opened.id(),
                new CloseCashClosureRequest(new BigDecimal("999"), null)))
                .isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> cashClosureService.update(opened.id(),
                new com.checkup.pharmacy.modules.cashclosure.dto.UpdateCashClosureRequest(
                        null, new BigDecimal("999"), null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Cannot edit a closed");
    }
}
