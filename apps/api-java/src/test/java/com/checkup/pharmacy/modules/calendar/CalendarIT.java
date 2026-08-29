package com.checkup.pharmacy.modules.calendar;

import com.checkup.pharmacy.common.enums.CalendarEventType;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.calendar.dto.CreateCalendarEventRequest;
import com.checkup.pharmacy.modules.calendar.dto.UpdateCalendarEventRequest;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.PurchasesService;
import com.checkup.pharmacy.modules.purchase.dto.CreatePurchaseOrderRequest;
import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderItemRequest;
import com.checkup.pharmacy.modules.supplier.Supplier;
import com.checkup.pharmacy.modules.supplier.SupplierRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.testsupport.AbstractPostgresIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The calendar feed: manual reminders merged with three auto-derived streams
 * (expiry alerts, credit-due dates, PO deliveries) that are computed fresh on
 * every read rather than stored.
 *
 * <p>Not {@code @Transactional} — {@code createEvent} calls
 * {@code NotificationService.inAppNotify}, which runs in
 * {@code Propagation.REQUIRES_NEW} and cannot see a pharmacy this test created
 * but never committed. Same reasoning as AuthIT/SupportIT.
 */
class CalendarIT extends AbstractPostgresIT {

    @Autowired private CalendarService calendarService;
    @Autowired private CalendarEventRepository calendarEventRepository;
    @Autowired private BillingService billingService;
    @Autowired private PurchasesService purchasesService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private UserRepository userRepository;

    private String pharmacyId;
    private String medicineId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();
        medicineId = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("12"))).getId();

        authenticateAs(user.getId(), pharmacyId, Role.OWNER);
    }

    private static String unique() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    @Test
    @DisplayName("a manual event appears in the feed for its own pharmacy")
    void manualEventAppearsInFeed() {
        Instant when = Instant.now().plus(2, ChronoUnit.DAYS);
        calendarService.createEvent(new CreateCalendarEventRequest(
                "Renew drug license", null, when, null, true, CalendarEventType.LICENSE_RENEWAL, null, null, null));

        var events = calendarService.getEvents(when.minus(1, ChronoUnit.HOURS), when.plus(1, ChronoUnit.HOURS));
        assertThat(events).anySatisfy(e -> assertThat(e.title()).isEqualTo("Renew drug license"));
    }

    @Test
    @DisplayName("a manual event outside the requested range is not returned")
    void manualEventOutsideRangeIsExcluded() {
        Instant farAway = Instant.now().plus(400, ChronoUnit.DAYS);
        calendarService.createEvent(new CreateCalendarEventRequest(
                "Far future reminder", null, farAway, null, true, CalendarEventType.CUSTOM, null, null, null));

        var events = calendarService.getEvents(Instant.now(), Instant.now().plus(7, ChronoUnit.DAYS));
        assertThat(events).noneSatisfy(e -> assertThat(e.title()).isEqualTo("Far future reminder"));
    }

    @Test
    @DisplayName("another pharmacy's manual event is invisible")
    void anotherPharmacysEventIsInvisible() {
        Instant when = Instant.now().plus(2, ChronoUnit.DAYS);
        var event = calendarService.createEvent(new CreateCalendarEventRequest(
                "Their reminder", null, when, null, true, CalendarEventType.CUSTOM, null, null, null));

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThatThrownBy(() -> calendarService.updateEvent(event.id(),
                new UpdateCalendarEventRequest(null, null, null, null, null, true, null)))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> calendarService.deleteEvent(event.id()))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("marking an event done persists across a fresh read")
    void markingEventDonePersists() {
        Instant when = Instant.now().plus(2, ChronoUnit.DAYS);
        var event = calendarService.createEvent(new CreateCalendarEventRequest(
                "Stock count", null, when, null, true, CalendarEventType.STOCK_AUDIT, null, null, null));

        calendarService.updateEvent(event.id(), new UpdateCalendarEventRequest(null, null, null, null, null, true, null));

        assertThat(calendarEventRepository.findById(event.id()).orElseThrow().isDone()).isTrue();
    }

    @Test
    @DisplayName("a batch nearing expiry is surfaced as an auto expiry-alert event")
    void expiringBatchIsSurfaced() {
        Instant expiry = Instant.now().plus(5, ChronoUnit.DAYS);
        Inventory batch = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-1",
                expiry, 40, new BigDecimal("10"), new BigDecimal("20"), 10, 5));

        var events = calendarService.getEvents(Instant.now(), Instant.now().plus(10, ChronoUnit.DAYS));

        assertThat(events).anySatisfy(e -> {
            assertThat(e.id()).isEqualTo("auto-expiry-" + batch.getId());
            assertThat(e.type()).isEqualTo(CalendarEventType.EXPIRY_ALERT);
            assertThat(e.isAutomatic()).isTrue();
        });
    }

    @Test
    @DisplayName("an unpaid credit invoice is surfaced 30 days after it was raised")
    void pendingCreditInvoiceIsSurfaced() {
        Customer credit = customerRepository.save(Customer.create(pharmacyId, "Credit Co"));
        credit.applyFields("Credit Co", null, null, null, null, null, null, null, null,
                com.checkup.pharmacy.common.enums.CustomerType.CREDIT, BigDecimal.ZERO,
                new BigDecimal("5000"), null);
        customerRepository.save(credit);
        Inventory batch = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-2",
                Instant.now().plus(365, ChronoUnit.DAYS), 40, new BigDecimal("10"), new BigDecimal("20"), 10, 5));

        var invoice = billingService.createInvoice(new CreateInvoiceRequest(credit.getId(), null, null, null, null, null,
                "CREDIT", "PENDING", null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batch.getId(), 2, null, BigDecimal.ZERO, null))));

        // Due date is createdAt + 30 days, so the view window must be centred there.
        Instant dueAround = Instant.now().plus(30, ChronoUnit.DAYS);
        var events = calendarService.getEvents(dueAround.minus(2, ChronoUnit.DAYS), dueAround.plus(2, ChronoUnit.DAYS));

        assertThat(events).anySatisfy(e -> {
            assertThat(e.id()).isEqualTo("auto-credit-" + invoice.id());
            assertThat(e.type()).isEqualTo(CalendarEventType.CREDIT_DUE);
        });
    }

    @Test
    @DisplayName("a purchase order awaiting delivery is surfaced as an auto PO-delivery event")
    void pendingPurchaseOrderIsSurfaced() {
        String supplierId = supplierRepository.save(Supplier.create(pharmacyId, "Acme Distributors")).getId();
        Instant expected = Instant.now().plus(3, ChronoUnit.DAYS);

        var po = purchasesService.createPO(new CreatePurchaseOrderRequest(supplierId, null, null, expected,
                List.of(new PurchaseOrderItemRequest(medicineId, "Amoxicillin 250", null, null, 50,
                        new BigDecimal("10"), new BigDecimal("20"), BigDecimal.ZERO)), null));

        var events = calendarService.getEvents(Instant.now(), Instant.now().plus(7, ChronoUnit.DAYS));

        assertThat(events).anySatisfy(e -> {
            assertThat(e.id()).isEqualTo("auto-po-" + po.id());
            assertThat(e.type()).isEqualTo(CalendarEventType.PO_DELIVERY);
        });
    }

    @Test
    @DisplayName("today's count includes both manual events and expiring batches")
    void todayCountIncludesBothKinds() {
        calendarService.createEvent(new CreateCalendarEventRequest(
                "Today's reminder", null, Instant.now(), null, true, CalendarEventType.CUSTOM, null, null, null));
        inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-3",
                Instant.now().plus(1, ChronoUnit.HOURS), 10, new BigDecimal("10"), new BigDecimal("20"), 10, 5));

        assertThat(calendarService.getTodayCount().count()).isGreaterThanOrEqualTo(2);
    }
}
