package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.inventory.InventoryService;
import com.checkup.pharmacy.modules.inventory.StockReservation;
import com.checkup.pharmacy.modules.inventory.StockReservationRepository;
import com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest;
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
 * Stock and credit invariants for the point of sale, against a real Postgres.
 *
 * <p>Every test here started as a reproduction of a defect found in the billing and
 * inventory audit. They are the regression net for:
 * <ul>
 *   <li>a till being refused stock it had reserved itself,</li>
 *   <li>a completed sale leaking its reservation for the TTL,</li>
 *   <li>cancellation destroying scheme goods,</li>
 *   <li>an unpaid credit bill with nobody to bill.</li>
 * </ul>
 */
@Transactional
class BillingStockAndCreditIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private InventoryService inventoryService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private StockReservationRepository reservationRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String userId;
    private String medicineId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        Medicine medicine = medicineRepository.save(Medicine.create("Paracetamol 500", new BigDecimal("12")));

        pharmacyId = pharmacy.getId();
        userId = user.getId();
        medicineId = medicine.getId();
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    @Nested
    @DisplayName("a till's own stock reservation")
    class OwnReservation {

        @Test
        @DisplayName("does not block the sale it was taken for, at any cart size")
        void doesNotBlockItsOwnSale() {
            // 60 of 100 — the case that used to fail, because the cart's own 60 were
            // subtracted from what it was allowed to take.
            reserveForSession("session-abc", 60);

            billingService.createInvoice(saleOf(60, "session-abc"));
            flushAndClear();

            assertThat(batch().getQuantity()).isEqualTo(40);
        }

        @Test
        @DisplayName("does not block a sale of the ENTIRE batch")
        void doesNotBlockAWholeBatchSale() {
            reserveForSession("session-abc", 100);

            billingService.createInvoice(saleOf(100, "session-abc"));
            flushAndClear();

            assertThat(batch().getQuantity()).isZero();
            assertThat(batch().getReservedQuantity()).isZero();
        }

        @Test
        @DisplayName("is released by the sale, so no stock stays held afterwards")
        void isReleasedBySale() {
            reserveForSession("session-abc", 10);

            billingService.createInvoice(saleOf(10, "session-abc"));
            flushAndClear();

            assertThat(batch().getQuantity()).isEqualTo(90);
            // Previously stayed at 10 until the 15-minute TTL swept it, hiding 10 units
            // from every other till.
            assertThat(batch().getReservedQuantity()).isZero();
            assertThat(reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, "session-abc")).isEmpty();
        }

        @Test
        @DisplayName("is released even for batches dropped from the cart before saving")
        void releasesBatchesNoLongerInTheCart() {
            String otherBatchId = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-2",
                    Instant.now().plus(365, ChronoUnit.DAYS), 50,
                    new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
            flushAndClear();

            // Both reserved, then the second is taken out of the cart before saving.
            inventoryService.reserve(new ReserveStockRequest("session-abc", List.of(
                    new ReserveStockRequest.Item(batchId, 10),
                    new ReserveStockRequest.Item(otherBatchId, 5))));
            flushAndClear();

            billingService.createInvoice(saleOf(10, "session-abc"));
            flushAndClear();

            assertThat(inventoryRepository.findById(otherBatchId).orElseThrow().getReservedQuantity())
                    .as("a reservation the sale did not consume must still be let go")
                    .isZero();
            assertThat(reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, "session-abc")).isEmpty();
        }

        @Test
        @DisplayName("still protects stock held by a DIFFERENT till")
        void anotherSessionsHoldIsStillRespected() {
            // The fix must not have turned the reservation system off.
            reserveForSession("other-till", 60);

            assertThatThrownBy(() -> billingService.createInvoice(saleOf(60, "session-abc")))
                    .hasMessageContaining("Insufficient stock")
                    .hasMessageContaining("60 reserved by another open billing session");

            assertThat(batch().getQuantity()).isEqualTo(100);
        }
    }

    /**
     * A hold whose TTL has passed is not a hold.
     *
     * <p>{@code Inventory.reservedQuantity} is denormalised and keeps counting an
     * expired reservation until something sweeps it, and the sweeper is a cron. Deciding
     * availability from that counter refused sales against stock that was already free —
     * for up to a sweep interval, with a message blaming a session that had ended.
     */
    @Nested
    @DisplayName("a hold that has already expired")
    class ExpiredReservation {

        @Test
        @DisplayName("does not block another till's sale")
        void expiredHoldDoesNotBlockAnotherTill() {
            expiredHoldFor("abandoned-till", 100);

            billingService.createInvoice(saleOf(10, "session-abc"));
            flushAndClear();

            assertThat(batch().getQuantity()).isEqualTo(90);
        }

        @Test
        @DisplayName("does not block the SAME till coming back to its own interrupted cart")
        void expiredHoldDoesNotBlockItsOwnTill() {
            // The counter case: build a cart, get pulled away past the TTL, come back
            // and press Save. The till's own dead row no longer matches its live set,
            // so it used to be counted as somebody else's and blocked its own sale.
            expiredHoldFor("session-abc", 100);

            billingService.createInvoice(saleOf(10, "session-abc"));
            flushAndClear();

            assertThat(batch().getQuantity()).isEqualTo(90);
        }

        @Test
        @DisplayName("still leaves a LIVE hold on the same batch in force")
        void aLiveHoldAlongsideAnExpiredOneStillCounts() {
            // Guards the obvious over-correction: ignoring expiry entirely.
            expiredHoldFor("abandoned-till", 50);
            reserveForSession("other-till", 60);

            assertThatThrownBy(() -> billingService.createInvoice(saleOf(60, "session-abc")))
                    .hasMessageContaining("60 reserved by another open billing session");

            assertThat(batch().getQuantity()).isEqualTo(100);
        }

        /**
         * Writes the state a lapsed hold actually leaves behind: a reservation row dated
         * in the past AND the denormalised counter still including it, which is what the
         * sweeper would later undo.
         */
        private void expiredHoldFor(String sessionId, int quantity) {
            reservationRepository.save(StockReservation.create(pharmacyId, batchId, sessionId,
                    quantity, Instant.now().minus(1, ChronoUnit.HOURS)));
            batch().reserve(quantity);
            flushAndClear();
            assertThat(batch().getReservedQuantity())
                    .as("the stale counter is the precondition this test exists for")
                    .isGreaterThanOrEqualTo(quantity);
        }
    }

    @Nested
    @DisplayName("cancelling an invoice")
    class Cancellation {

        @Test
        @DisplayName("returns the scheme goods to the shelf, not just the charged units")
        void restoresFreeQuantity() {
            var invoice = billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 10, 2, BigDecimal.ZERO, null))));
            flushAndClear();
            assertThat(batch().getQuantity()).isEqualTo(88); // 10 charged + 2 free left the shelf

            billingService.cancelInvoice(invoice.id(), "customer changed their mind");
            flushAndClear();

            // Used to restore 10 and silently destroy the 2 free units.
            assertThat(batch().getQuantity()).isEqualTo(100);
        }

        @Test
        @DisplayName("records the restored total on the ledger, so it reconciles with the shelf")
        void ledgerMatchesTheRestore() {
            var invoice = billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 10, 2, BigDecimal.ZERO, null))));
            flushAndClear();
            billingService.cancelInvoice(invoice.id(), "wrong item");
            flushAndClear();

            Integer restored = entityManager.createQuery(
                            "SELECT m.quantity FROM InventoryMovement m WHERE m.inventoryId = :id "
                                    + "AND m.referenceType = 'INVOICE_CANCEL'", Integer.class)
                    .setParameter("id", batchId)
                    .getSingleResult();
            assertThat(restored).isEqualTo(12);
        }
    }

    @Nested
    @DisplayName("an unpaid credit sale")
    class CreditSales {

        @Test
        @DisplayName("is refused when there is no customer to bill")
        void needsACustomer() {
            assertThatThrownBy(() -> billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CREDIT", "PENDING", null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 5, null, BigDecimal.ZERO, null)))))
                    .isInstanceOf(UnprocessableEntityException.class)
                    .hasMessageContaining("needs a customer");

            assertThat(batch().getQuantity()).as("nothing may leave the shelf").isEqualTo(100);
        }

        @Test
        @DisplayName("is still allowed, and charged to the customer, when one is given")
        void chargesTheCustomer() {
            Customer customer = creditCustomer(new BigDecimal("5000"));

            billingService.createInvoice(new CreateInvoiceRequest(customer.getId(), null, null, null, null, null, "CREDIT", "PENDING", null, null, null, null,
                    null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 5, null, BigDecimal.ZERO, null))));
            flushAndClear();

            assertThat(customerRepository.findById(customer.getId()).orElseThrow().getCreditUsed())
                    .isEqualByComparingTo("100");
        }

        @Test
        @DisplayName("a PAID counter sale marked CREDIT needs no customer — nothing is owed")
        void paidCreditSaleIsNotADebt() {
            billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CREDIT", "PAID", null, null, null, null, null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 5, null, BigDecimal.ZERO, null))));
            flushAndClear();

            assertThat(batch().getQuantity()).isEqualTo(95);
        }

        @Test
        @DisplayName("is still held to the credit limit")
        void limitStillEnforced() {
            Customer customer = creditCustomer(new BigDecimal("50"));

            assertThatThrownBy(() -> billingService.createInvoice(new CreateInvoiceRequest(customer.getId(), null, null, null, null, null, "CREDIT", "PENDING", null, null, null, null,
                    null, null, null, null, null,
                    List.of(new InvoiceItemRequest(batchId, 5, null, BigDecimal.ZERO, null)))))
                    .hasMessageContaining("Credit limit exceeded");
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void reserveForSession(String sessionId, int quantity) {
        inventoryService.reserve(new ReserveStockRequest(sessionId,
                List.of(new ReserveStockRequest.Item(batchId, quantity))));
        flushAndClear();
        assertThat(batch().getReservedQuantity()).isEqualTo(quantity);
    }

    private CreateInvoiceRequest saleOf(int quantity, String sessionId) {
        return new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, sessionId,
                List.of(new InvoiceItemRequest(batchId, quantity, null, BigDecimal.ZERO, null)));
    }

    private Customer creditCustomer(BigDecimal limit) {
        Customer customer = customerRepository.save(Customer.create(pharmacyId, "Ram Kumar"));
        customer.applyFields("Ram Kumar", "9876543210", null, null, null, null, null, null, null,
                CustomerType.CREDIT, BigDecimal.ZERO, limit, null);
        flushAndClear();
        return customerRepository.findById(customer.getId()).orElseThrow();
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private Inventory batch() {
        return inventoryRepository.findById(batchId).orElseThrow();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
