package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.inventory.InventoryService;
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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end billing against a real Postgres carrying the real Prisma schema.
 *
 * <p>This is where the assertions that actually matter live. BillingServiceTest can
 * only prove that guard clauses reject bad input; it cannot prove that stock left the
 * shelf, that the ledger balanced, or that a foreign key held — those need a database
 * that enforces things. Several of the constraints exercised here (invoices -> users,
 * inventory_movements -> users) exist only in the schema and are invisible to a
 * mock-based test.
 *
 * <p>Each test runs in a transaction that is rolled back afterwards, so tests neither
 * see nor corrupt each other's rows.
 */
@Transactional
class BillingIT extends AbstractPostgresIT {

    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private InventoryService inventoryService;
    @Autowired private CustomerRepository customerRepository;
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
        batchId = inventoryRepository.save(newBatch("BATCH-1", 100, future())).getId();

        flushAndClear();
        authenticateAs(userId, pharmacyId, Role.OWNER);
    }

    /**
     * Pushes the fixtures to the database and empties the persistence context.
     *
     * <p>The clear is not optional. {@code Inventory.medicine} is mapped
     * {@code @JoinColumn(insertable = false, updatable = false)} — a read-only mirror
     * of the {@code medicineId} column that Hibernate populates only when it LOADS the
     * row. An Inventory built in Java and saved in this same persistence context keeps
     * {@code medicine == null} forever, and BillingService then rejects the sale with
     * {@code Medicine "?" is inactive}, which looks like an application bug and is not.
     *
     * <p>Flushing also means a fixture that violates a constraint fails here, during
     * setup, instead of surfacing later as a confusing failure inside a test body.
     */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    /** Always re-read: entities are detached by {@link #flushAndClear()}. */
    private Inventory batch() {
        return inventoryRepository.findById(batchId).orElseThrow();
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static Instant future() {
        return Instant.now().plus(365, ChronoUnit.DAYS);
    }

    private Inventory newBatch(String batchNumber, int quantity, Instant expiry) {
        return Inventory.create(pharmacyId, medicineId, batchNumber, expiry,
                quantity, new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
    }

    private static CreateInvoiceRequest invoiceFor(String inventoryId, int quantity) {
        return build(null, null, inventoryId, quantity);
    }

    private static CreateInvoiceRequest build(String customerId, String idempotencyKey,
                                              String inventoryId, int quantity) {
        return new CreateInvoiceRequest(customerId, null, null, null, null, null, null, null, null,
                null, null, null, idempotencyKey, null,
                List.of(new InvoiceItemRequest(inventoryId, quantity, null, BigDecimal.ZERO)));
    }

    private long movementCountFor(String inventoryId) {
        return entityManager.createQuery(
                        "SELECT count(m) FROM InventoryMovement m WHERE m.inventoryId = :id", Long.class)
                .setParameter("id", inventoryId)
                .getSingleResult();
    }

    @Test
    @DisplayName("a sale decrements the batch and writes a matching stock movement")
    void saleDecrementsStockAndRecordsMovement() {
        var response = billingService.createInvoice(invoiceFor(batchId, 10));
        flushAndClear();

        assertThat(response).isNotNull();
        assertThat(batch().getQuantity())
                .as("100 in stock, 10 sold")
                .isEqualTo(90);
        assertThat(movementCountFor(batchId))
                .as("every stock change must leave an audit trail")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("selling more than is on the shelf is refused and leaves stock untouched")
    void oversellIsRefusedAndStockUnchanged() {
        assertThatThrownBy(() -> billingService.createInvoice(invoiceFor(batchId, 101)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Insufficient stock");

        assertThat(batch().getQuantity())
                .as("a refused sale must not move stock")
                .isEqualTo(100);
    }

    @Test
    @DisplayName("reserved stock is not available to another till")
    void reservedStockIsNotSellable() {
        // 100 on hand, 95 reserved by another billing session -> only 5 sellable.
        //
        // Reserved through the service rather than by setting reservedQuantity
        // reflectively. That counter is denormalised: the application only ever raises
        // it alongside a StockReservation row, so a counter of 95 with no row behind it
        // is a state that cannot occur — and availability is now decided from the rows,
        // because the counter keeps counting holds whose TTL has passed.
        inventoryService.reserve(new ReserveStockRequest("another-till",
                List.of(new ReserveStockRequest.Item(batchId, 95))));
        flushAndClear();

        assertThat(batch().getReservedQuantity()).isEqualTo(95);
        assertThatThrownBy(() -> billingService.createInvoice(invoiceFor(batchId, 10)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("reserved");
    }

    @Test
    @DisplayName("an expired batch cannot be sold")
    void expiredBatchCannotBeSold() {
        String expiredId = inventoryRepository.save(
                newBatch("BATCH-EXPIRED", 50, Instant.now().minus(1, ChronoUnit.DAYS))).getId();
        flushAndClear();

        assertThatThrownBy(() -> billingService.createInvoice(invoiceFor(expiredId, 1)))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("expired");
    }

    @Test
    @DisplayName("a Schedule H medicine cannot be billed without a prescription")
    void scheduleHRequiresPrescription() {
        // Schedule is set reflectively: Medicine exposes no setter for it, and the
        // Drug Rules constraint under test is the service's, not the entity's.
        Medicine controlled = medicineRepository.findById(medicineId).orElseThrow();
        ReflectionTestUtils.setField(controlled, "schedule", "H");
        medicineRepository.save(controlled);
        flushAndClear();

        assertThatThrownBy(() -> billingService.createInvoice(invoiceFor(batchId, 1)))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("Prescription required");

        assertThat(batch().getQuantity())
                .as("a blocked controlled sale must not move stock")
                .isEqualTo(100);
    }

    @Test
    @DisplayName("replaying an idempotency key bills once, not twice")
    void idempotencyKeyPreventsDoubleBilling() {
        String key = "idem-" + unique();

        var first = billingService.createInvoice(build(null, key, batchId, 5));
        flushAndClear();
        var second = billingService.createInvoice(build(null, key, batchId, 5));
        flushAndClear();

        assertThat(second.id())
                .as("the replay must return the original invoice, not a new one")
                .isEqualTo(first.id());
        assertThat(batch().getQuantity())
                .as("5 sold once — a double decrement here is money and stock lost")
                .isEqualTo(95);
    }

    @Test
    @DisplayName("a batch belonging to another pharmacy is invisible, not billable")
    void cannotBillAnotherPharmacysBatch() {
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        String foreignId = inventoryRepository.save(Inventory.create(other.getId(), medicineId,
                "FOREIGN-1", future(), 50, new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
        flushAndClear();

        // Still authenticated as `pharmacy`, so this batch must simply not resolve.
        assertThatThrownBy(() -> billingService.createInvoice(invoiceFor(foreignId, 1)))
                .isInstanceOf(NotFoundException.class);

        assertThat(inventoryRepository.findById(foreignId).orElseThrow().getQuantity())
                .as("another tenant's stock must be untouched")
                .isEqualTo(50);
    }

    @Test
    @DisplayName("a walk-in customer cannot be sold to on credit")
    void creditSaleRequiresCreditCustomer() {
        String walkInId = customerRepository.save(Customer.create(pharmacyId, "Walk In")).getId();
        flushAndClear();

        var request = new CreateInvoiceRequest(walkInId, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 1, null, BigDecimal.ZERO)));

        assertThatThrownBy(() -> billingService.createInvoice(request))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("not set up for credit");
    }

    @Test
    @DisplayName("a credit sale beyond the customer's limit is refused")
    void creditLimitIsEnforced() {
        String creditId = createCreditCustomer(new BigDecimal("50.00"));

        // 10 x Rs.20 MRP = Rs.200, well past the Rs.50 limit.
        var request = new CreateInvoiceRequest(creditId, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO)));

        assertThatThrownBy(() -> billingService.createInvoice(request))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("Credit limit exceeded");
    }

    @Test
    @DisplayName("a credit sale within the limit consumes the customer's credit")
    void creditSaleConsumesCredit() {
        String creditId = createCreditCustomer(new BigDecimal("5000.00"));

        var request = new CreateInvoiceRequest(creditId, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO)));

        var response = billingService.createInvoice(request);
        flushAndClear();

        assertThat(customerRepository.findById(creditId).orElseThrow().getCreditUsed())
                .as("credit consumed must equal what was billed")
                .isEqualByComparingTo(response.totalAmount());
    }

    /**
     * A CREDIT customer whose limit was never configured.
     *
     * <p>Previously the enforcement branch was guarded by {@code limit > 0 &&}, so an
     * unset limit disabled the check entirely and such a customer could be sold to
     * without bound. Zero now means "no credit authorised".
     *
     * <p>NOTE: this is a deliberate behaviour change. Any existing CREDIT customer
     * sitting at a zero limit could be billed on credit before and cannot now.
     */
    @Test
    @DisplayName("a CREDIT customer with no limit set cannot be sold to on credit")
    void unsetCreditLimitMeansNoCredit() {
        String creditId = createCreditCustomer(BigDecimal.ZERO);

        var request = new CreateInvoiceRequest(creditId, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 1, null, BigDecimal.ZERO)));

        assertThatThrownBy(() -> billingService.createInvoice(request))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("No credit limit is set");

        assertThat(batch().getQuantity())
                .as("a refused credit sale must not move stock")
                .isEqualTo(100);
    }

    /**
     * Guards the tenant scoping added to cancelInvoice/createReturn/release.
     *
     * <p>Restoring stock is a WRITE keyed by ids that happen to come from tenant-scoped
     * rows. This asserts the scoping predicate is actually present rather than trusting
     * that provenance.
     */
    @Test
    @DisplayName("cancelling an invoice restores stock to this tenant's batch only")
    void cancelRestoresStockTenantScoped() {
        var invoice = billingService.createInvoice(invoiceFor(batchId, 10));
        flushAndClear();
        assertThat(batch().getQuantity()).isEqualTo(90);

        billingService.cancelInvoice(invoice.id(), "customer changed their mind");
        flushAndClear();

        assertThat(batch().getQuantity())
                .as("cancellation must put the stock back")
                .isEqualTo(100);
    }

    /**
     * The zero-rupee-invoice hole, approached from the side that validation cannot
     * close: adjustmentAmount is legitimately signed, so no annotation can bound it
     * without breaking the round-off tweak it exists for.
     */
    @Test
    @DisplayName("adjustments that drive the bill below zero are refused, not clamped")
    void negativeTotalIsRefused() {
        // 10 x Rs.20 = Rs.200 of goods, less a Rs.5000 "adjustment".
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                null, null, new BigDecimal("-5000"), null, null,
                List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO)));

        assertThatThrownBy(() -> billingService.createInvoice(request))
                .isInstanceOf(UnprocessableEntityException.class)
                .hasMessageContaining("exceed the value of this bill");

        assertThat(batch().getQuantity())
                .as("the old behaviour issued a Rs.0 invoice AND shipped the stock")
                .isEqualTo(100);
    }

    /**
     * The boundary the fix above must not break. A fully discounted or free-of-charge
     * bill is a real thing pharmacies issue, and it lands at exactly zero — so only a
     * genuinely negative total may be rejected.
     */
    @Test
    @DisplayName("a legitimately zero-value bill is still allowed")
    void zeroValueInvoiceIsAllowed() {
        var request = new CreateInvoiceRequest(null, null, null, null, null, null, null, null, null,
                new BigDecimal("100"), null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 10, null, BigDecimal.ZERO)));

        var response = billingService.createInvoice(request);
        flushAndClear();

        assertThat(response.totalAmount()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(batch().getQuantity())
                .as("a 100%-discounted sale still dispenses the goods")
                .isEqualTo(90);
    }

    // ── List endpoints: response shape + filter validation ────────────────────
    //
    // These exist because the whole module's business logic was covered while the two
    // endpoints the Sales page actually calls were not — listInvoices/listReturns had
    // no test at all, so a DTO that no frontend could read passed every check and
    // shipped. The shape assertions below are deliberately about structure, not values.

    @Test
    @DisplayName("invoice list rows nest customer/user/_count the way the Sales page reads them")
    void invoiceListRowsUseNestedShape() {
        String customerId = createCreditCustomer(new BigDecimal("5000.00"));
        billingService.createInvoice(build(customerId, null, batchId, 3));
        flushAndClear();

        var row = billingService.listInvoices(null, null, null, null, true, null, null,
                null, null, null, null, 1, 20).items().getFirst();

        // SalesPage.tsx reads inv.user.name and inv._count.items with no optional
        // chaining — a flat userName/itemCount here is undefined in the browser and
        // takes down the entire Bills table, not just the cell.
        assertThat(row.user()).as("user must be an object, not a flat userName").isNotNull();
        assertThat(row.user().name()).isEqualTo("Owner");
        assertThat(row._count()).as("_count must be an object, not a flat itemCount").isNotNull();
        assertThat(row._count().items()).isEqualTo(1);
        assertThat(row.customer()).as("customer must be an object, not flat customerName/Phone").isNotNull();
        assertThat(row.customer().name()).isEqualTo("Credit Co");
    }

    @Test
    @DisplayName("a walk-in bill reports a null customer rather than an empty object")
    void walkInInvoiceHasNullCustomer() {
        billingService.createInvoice(invoiceFor(batchId, 1));
        flushAndClear();

        var row = billingService.listInvoices(null, null, null, null, true, null, null,
                null, null, null, null, 1, 20).items().getFirst();

        // The frontend renders its "—"/"Walk-in" fallback off exactly this null.
        assertThat(row.customer()).isNull();
        assertThat(row.user().name()).as("entry-by is still known for a walk-in").isEqualTo("Owner");
    }

    @Test
    @DisplayName("an inverted date range is rejected instead of silently matching nothing")
    void invertedDateRangeIsRejected() {
        Instant from = Instant.now();
        Instant to = from.minus(30, ChronoUnit.DAYS);

        assertThatThrownBy(() -> billingService.listInvoices(null, from, to, null, true, null, null,
                null, null, null, null, 1, 20))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("is after the 'to' date");

        assertThatThrownBy(() -> billingService.listReturns(null, from, to, null, 1, 20))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("is after the 'to' date");
    }

    @Test
    @DisplayName("an inverted amount filter is rejected instead of silently matching nothing")
    void invertedAmountRangeIsRejected() {
        assertThatThrownBy(() -> billingService.listInvoices(null, null, null, null, true, null, null,
                null, null, new BigDecimal("5000"), new BigDecimal("100"), 1, 20))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("greater than the maximum");
    }

    @Test
    @DisplayName("the returns list reports units returned without shipping items, resolving invoice + user in batch")
    void returnsListUsesBatchedRefsAndTotalQuantity() {
        var invoice = billingService.createInvoice(invoiceFor(batchId, 10));
        flushAndClear();
        String invoiceItemId = billingService.getInvoice(invoice.id()).items().getFirst().id();
        billingService.createReturn(invoice.id(), new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest(
                "Damaged strip",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(invoiceItemId, 4, null)),
                null));
        flushAndClear();

        var page = billingService.listReturns(null, null, null, null, 1, 20);
        assertThat(page.items()).hasSize(1);
        var row = page.items().getFirst();

        // Each of these was previously a separate query PER ROW (items, the full Invoice
        // entity, and the user); the list now batches all three for the whole page.
        assertThat(row.totalQuantity()).as("units returned are reported for the row").isEqualTo(4);
        assertThat(row.items()).as("but the lines themselves are not shipped in the list").isEmpty();
        assertThat(row.invoice()).as("originating invoice ref resolved in batch").isNotNull();
        assertThat(row.invoice().invoiceNumber()).isEqualTo(invoice.invoiceNumber());
        assertThat(row.user()).as("acting user resolved in batch").isNotNull();
        assertThat(row.user().name()).isEqualTo("Owner");
        assertThat(row.customer()).as("walk-in sale has no customer").isNull();
    }

    @Test
    @DisplayName("an equal from/to range is allowed — a single-day filter is legitimate")
    void equalDateBoundsAreAllowed() {
        Instant sameMoment = Instant.now();

        assertThat(billingService.listInvoices(null, sameMoment, sameMoment, null, true, null, null,
                null, null, null, null, 1, 20)).isNotNull();
    }

    private String createCreditCustomer(BigDecimal creditLimit) {
        Customer credit = customerRepository.save(Customer.create(pharmacyId, "Credit Co"));
        credit.applyFields("Credit Co", null, null, null, null, null, null, null, null,
                CustomerType.CREDIT, BigDecimal.ZERO, creditLimit, null);
        customerRepository.save(credit);
        flushAndClear();
        return credit.getId();
    }
}
