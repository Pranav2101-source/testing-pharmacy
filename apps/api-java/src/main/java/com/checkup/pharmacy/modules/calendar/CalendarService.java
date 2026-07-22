package com.checkup.pharmacy.modules.calendar;

import com.checkup.pharmacy.common.enums.CalendarEventType;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.modules.billing.Invoice;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.calendar.dto.CalendarEventResponse;
import com.checkup.pharmacy.modules.calendar.dto.CreateCalendarEventRequest;
import com.checkup.pharmacy.modules.calendar.dto.TodayCountResponse;
import com.checkup.pharmacy.modules.calendar.dto.UpdateCalendarEventRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.notification.NotificationService;
import com.checkup.pharmacy.modules.purchase.PurchaseOrder;
import com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Manual reminders plus three auto-derived event streams (expiry alerts, credit
 * due, PO deliveries) merged into one chronological feed. The auto-derived
 * events are never persisted — they're computed fresh from Inventory/Invoice/
 * PurchaseOrder on every read, using a synthetic id ({@code auto-<kind>-<id>})
 * so the frontend can render them alongside manual events without a separate
 * code path.
 */
@Service
public class CalendarService {

    private static final Duration CREDIT_DUE_OFFSET = Duration.ofDays(30);
    private static final Map<CalendarEventType, String> EVENT_TYPE_LABELS = Map.of(
            CalendarEventType.EXPIRY_ALERT, "Expiry Alert",
            CalendarEventType.CREDIT_DUE, "Credit Due",
            CalendarEventType.PO_DELIVERY, "PO Delivery",
            CalendarEventType.BILL_REMINDER, "Bill Reminder",
            CalendarEventType.STOCK_AUDIT, "Stock Audit",
            CalendarEventType.LICENSE_RENEWAL, "License Renewal",
            CalendarEventType.CUSTOM, "Event");

    private final CalendarEventRepository calendarEventRepository;
    private final InventoryRepository inventoryRepository;
    private final InvoiceRepository invoiceRepository;
    private final PurchaseOrderRepository purchaseOrderRepository;
    private final NotificationService notificationService;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public CalendarService(CalendarEventRepository calendarEventRepository, InventoryRepository inventoryRepository,
                           InvoiceRepository invoiceRepository, PurchaseOrderRepository purchaseOrderRepository,
                           NotificationService notificationService,
                           com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.calendarEventRepository = calendarEventRepository;
        this.inventoryRepository = inventoryRepository;
        this.invoiceRepository = invoiceRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.notificationService = notificationService;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional(readOnly = true)
    public List<CalendarEventResponse> getEvents(Instant fromParam, Instant toParam) {
        String pharmacyId = TenantContext.pharmacyId();

        Instant now = Instant.now();
        Instant from = fromParam != null ? fromParam : defaultFrom(now);
        Instant to = toParam != null ? toParam : defaultTo(now);

        List<CalendarEventResponse> events = new ArrayList<>();

        for (CalendarEvent e : calendarEventRepository.findManualEventsInRange(pharmacyId, from, to)) {
            events.add(new CalendarEventResponse(e.getId(), e.getTitle(), e.getDescription(), e.getDate(),
                    e.getEndDate(), e.isAllDay(), e.getType(), e.getColor(), e.getRelatedId(), e.getRelatedType(),
                    e.isDone(), false, e.getCreatedAt()));
        }

        for (Inventory inv : inventoryRepository.findExpiringBatchesInRange(pharmacyId, from, to)) {
            long daysLeft = (long) Math.ceil(
                    (inv.getExpiryDate().toEpochMilli() - now.toEpochMilli()) / 86_400_000.0);
            String daysLabel = daysLeft <= 0 ? "Expired" : daysLeft + " day" + (daysLeft != 1 ? "s" : "") + " remaining";
            String medicineName = inv.getMedicine() != null ? inv.getMedicine().getName() : "Medicine";
            events.add(new CalendarEventResponse("auto-expiry-" + inv.getId(),
                    medicineName + " — batch " + inv.getBatchNumber() + " expires",
                    inv.getQuantity() + " units · " + daysLabel,
                    inv.getExpiryDate(), null, true, CalendarEventType.EXPIRY_ALERT, null,
                    inv.getId(), "inventory", false, true, null));
        }

        Instant shiftedFrom = from.minus(CREDIT_DUE_OFFSET);
        Instant shiftedTo = to.minus(CREDIT_DUE_OFFSET);
        for (Invoice inv : invoiceRepository.findPendingCreditInShiftedRange(pharmacyId, shiftedFrom, shiftedTo)) {
            Instant dueDate = inv.getCreatedAt().plus(CREDIT_DUE_OFFSET);
            String customerName = inv.getCustomer() != null ? inv.getCustomer().getName() : "Walk-in";
            String amtStr = "₹" + inv.getTotalAmount().toPlainString();
            events.add(new CalendarEventResponse("auto-credit-" + inv.getId(),
                    "Credit due — " + customerName + " (" + amtStr + ")",
                    "Invoice " + inv.getInvoiceNumber() + " · " + inv.getPaymentStatus(),
                    dueDate, null, true, CalendarEventType.CREDIT_DUE, null,
                    inv.getId(), "invoice", false, true, null));
        }

        for (PurchaseOrder po : purchaseOrderRepository.findPendingDeliveriesInRange(pharmacyId, from, to)) {
            String supplierName = po.getSupplier() != null ? po.getSupplier().getName() : "Supplier";
            events.add(new CalendarEventResponse("auto-po-" + po.getId(),
                    "Delivery expected — " + supplierName,
                    "PO " + po.getOrderNumber() + " · " + po.getStatus(),
                    po.getExpectedDate(), null, true, CalendarEventType.PO_DELIVERY, null,
                    po.getId(), "purchase_order", false, true, null));
        }

        events.sort((a, b) -> a.date().compareTo(b.date()));
        return events;
    }

    @Transactional(readOnly = true)
    public TodayCountResponse getTodayCount() {
        String pharmacyId = TenantContext.pharmacyId();
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Instant start = today.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant end = today.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().minusMillis(1);

        long manual = calendarEventRepository.countByPharmacyIdAndDateBetween(pharmacyId, start, end);
        long expiring = inventoryRepository.countExpiringBatchesInRange(pharmacyId, start, end);
        return new TodayCountResponse(manual + expiring);
    }

    @Transactional
    public CalendarEventResponse createEvent(CreateCalendarEventRequest req) {
        duplicateSubmitGuard.guard("calendar.create", req);
        String pharmacyId = TenantContext.pharmacyId();
        boolean allDay = req.allDay() == null || req.allDay();
        CalendarEvent event = CalendarEvent.create(pharmacyId, TenantContext.userId(), req.title().trim(),
                req.description(), req.date(), req.endDate(), allDay, req.type(), req.color(),
                req.relatedId(), req.relatedType());
        calendarEventRepository.save(event);

        String typeLabel = EVENT_TYPE_LABELS.getOrDefault(event.getType(), event.getType().name());
        String dateStr = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
                .withLocale(Locale.forLanguageTag("en-IN"))
                .format(event.getDate().atZone(ZoneOffset.UTC).toLocalDate());
        String message = "Scheduled for " + dateStr
                + (event.getDescription() != null ? " — " + event.getDescription() : "");
        notificationService.inAppNotify(pharmacyId, "📅 " + typeLabel + ": " + event.getTitle(), message);

        return toResponse(event);
    }

    @Transactional
    public CalendarEventResponse updateEvent(String id, UpdateCalendarEventRequest req) {
        CalendarEvent event = load(id);
        event.applyUpdate(req.title(), req.description(), req.date(), req.endDate(), req.allDay(), req.isDone(),
                req.color());
        return toResponse(event);
    }

    @Transactional
    public void deleteEvent(String id) {
        CalendarEvent event = load(id);
        calendarEventRepository.delete(event);
    }

    private CalendarEvent load(String id) {
        return calendarEventRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Calendar event not found"));
    }

    private static CalendarEventResponse toResponse(CalendarEvent e) {
        return new CalendarEventResponse(e.getId(), e.getTitle(), e.getDescription(), e.getDate(), e.getEndDate(),
                e.isAllDay(), e.getType(), e.getColor(), e.getRelatedId(), e.getRelatedType(), e.isDone(), false,
                e.getCreatedAt());
    }

    private static Instant defaultFrom(Instant now) {
        LocalDate d = now.atZone(ZoneOffset.UTC).toLocalDate().withDayOfMonth(1).minusMonths(1);
        return d.atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    private static Instant defaultTo(Instant now) {
        LocalDate d = now.atZone(ZoneOffset.UTC).toLocalDate().withDayOfMonth(1).plusMonths(2).minusDays(1);
        return d.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().minusMillis(1);
    }
}
