package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.modules.reports.dto.ScheduleHItemResponse;
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
 * Reporting: daily sales, GST, dead stock, valuation, EOD summary.
 *
 * <p>Review found this module already careful — every method scopes to
 * {@code TenantContext.pharmacyId()}, the two unscoped {@code findAllById}
 * calls are display enrichment on ids already tenant-derived (allowlisted
 * earlier in the session), and {@code scheduleRegister} refuses rather than
 * silently truncates a statutory register once it would exceed 10,000 rows —
 * a genuinely careful compliance decision. No defects found, so this suite is
 * proportionate: correctness + tenant isolation on a representative set,
 * rather than exhaustive coverage of every report.
 */
@Transactional
class ReportsIT extends AbstractPostgresIT {

    @Autowired private ReportsService reportsService;
    @Autowired private BillingService billingService;
    @Autowired private PharmacyRepository pharmacyRepository;
    @Autowired private MedicineRepository medicineRepository;
    @Autowired private InventoryRepository inventoryRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PrescriptionRepository prescriptionRepository;
    @Autowired private EntityManager entityManager;

    private String pharmacyId;
    private String medicineId;
    private String batchId;

    @BeforeEach
    void seed() {
        Pharmacy pharmacy = pharmacyRepository.save(Pharmacy.create("Test Pharmacy", "ph-" + unique()));
        User user = userRepository.save(User.create(pharmacy.getId(), "Owner",
                "owner-" + unique() + "@test.local", "9000000000", "hash", Role.OWNER));
        pharmacyId = pharmacy.getId();

        Medicine medicine = medicineRepository.save(Medicine.create("Amoxicillin 250", new BigDecimal("18")));
        medicineId = medicine.getId();
        batchId = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "BATCH-1",
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

    private void cashSale(int units) {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, "CASH", "PAID",
                null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO))));
        flushAndClear();
    }

    @Test
    @DisplayName("today's sales appear in the daily sales report")
    void dailySalesReflectsTodaysInvoices() {
        cashSale(2); // Rs.200

        var report = reportsService.dailySales(null);

        assertThat(report.invoiceCount()).isEqualTo(1);
        assertThat(report.revenue()).isEqualByComparingTo(new BigDecimal("200"));
    }

    @Test
    @DisplayName("the GST summary aggregates tax collected over the requested range")
    void gstSummaryAggregatesTax() {
        cashSale(1);

        var summary = reportsService.gstSummary(Instant.now().minus(1, ChronoUnit.HOURS), Instant.now());

        assertThat(summary._count()).isGreaterThanOrEqualTo(1);
        assertThat(summary._sum().totalAmount()).isGreaterThan(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("another pharmacy's sales do not inflate this pharmacy's daily report")
    void dailySalesIsTenantScoped() {
        cashSale(1);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9111111111", "hash", Role.OWNER));
        Medicine otherMedicine = medicineRepository.save(Medicine.create("Paracetamol 500", new BigDecimal("12")));
        String otherBatch = inventoryRepository.save(Inventory.create(other.getId(), otherMedicine.getId(), "OB-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("10"), new BigDecimal("20"), 10, 5)).getId();
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, "CASH", "PAID",
                null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(otherBatch, 5, null, BigDecimal.ZERO))));
        flushAndClear();

        var otherReport = reportsService.dailySales(null);
        assertThat(otherReport.invoiceCount())
                .as("the other pharmacy's own report must only count its own sale")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a batch with no sale since the threshold is reported as dead stock")
    void unsoldBatchIsDeadStock() {
        var report = reportsService.deadStock(90);

        assertThat(report.items()).anySatisfy(item -> {
            assertThat(item.id()).isEqualTo(batchId);
            // 100 units x Rs.50 purchase rate
            assertThat(item.costAtRisk()).isEqualByComparingTo(new BigDecimal("5000.00"));
        });
    }

    @Test
    @DisplayName("a batch sold within the threshold is not dead stock")
    void recentlySoldBatchIsNotDeadStock() {
        cashSale(1);

        var report = reportsService.deadStock(90);

        assertThat(report.items()).noneSatisfy(item -> assertThat(item.id()).isEqualTo(batchId));
    }

    @Test
    @DisplayName("inventory valuation sums cost and retail value across stock")
    void inventoryValuationSumsCorrectly() {
        var valuation = reportsService.inventoryValuation("medicine");

        // 100 units x Rs.50 cost, x Rs.100 retail
        assertThat(valuation.totalCostValue()).isEqualByComparingTo(new BigDecimal("5000.00"));
        assertThat(valuation.totalRetailValue()).isEqualByComparingTo(new BigDecimal("10000.00"));
    }

    @Test
    @DisplayName("EOD summary reflects today's GST collected and top-selling medicine")
    void eodSummaryReflectsTodaysActivity() {
        cashSale(3);

        var eod = reportsService.eodSummary();

        assertThat(eod.gstCollected()).isGreaterThan(BigDecimal.ZERO);
        assertThat(eod.topMedicines()).anySatisfy(m -> assertThat(m.medicineName()).isEqualTo("Amoxicillin 250"));
    }

    @Test
    @DisplayName("a Schedule H sale appears in the compliance register")
    void scheduleHSaleAppearsInRegister() {
        Medicine controlled = medicineRepository.findById(medicineId).orElseThrow();
        org.springframework.test.util.ReflectionTestUtils.setField(controlled, "schedule", "H");
        medicineRepository.save(controlled);
        flushAndClear();

        // Schedule H requires a prescription to bill at all; a prescription-linked
        // sale is what puts a row in the register.
        Prescription prescription = Prescription.create(pharmacyId, "PRESC-1", null, "Dr Test", null, null,
                "Test Patient", null, null, null, Instant.now(),
                Instant.now().plus(30, ChronoUnit.DAYS), null, null);
        prescriptionRepository.save(prescription);
        flushAndClear();

        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, prescription.getId(), "CASH", "PAID",
                null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 1, null, BigDecimal.ZERO))));
        flushAndClear();

        List<ScheduleHItemResponse> register =
                reportsService.scheduleRegister(Instant.now().minus(1, ChronoUnit.HOURS), Instant.now(), "H");

        assertThat(register).anySatisfy(item ->
                assertThat(item.inventory().medicine().name()).isEqualTo("Amoxicillin 250"));
    }

    // ── Daily sales series ─────────────────────────────────────────────────────
    //
    // Added with the endpoint that replaced the chart's day-by-day fan-out (seven HTTP
    // calls, two DB queries each) with one grouped query. The gap-filling matters: the
    // chart needs a continuous axis, so quiet days must come back as explicit zeros.

    @Test
    @DisplayName("the daily series returns one row per day, filling days with no sales")
    void dailySeriesFillsEmptyDays() {
        cashSale(2); // Rs.200 today

        java.time.LocalDate today = java.time.LocalDate.now(java.time.ZoneOffset.ofHoursMinutes(5, 30));
        String from = today.minusDays(6).toString();
        var series = reportsService.dailySalesSeries(from, today.toString());

        assertThat(series).as("one row per day across the 7-day window").hasSize(7);
        assertThat(series.get(0).date()).isEqualTo(from);
        assertThat(series.get(6).date()).isEqualTo(today.toString());

        var todayRow = series.get(6);
        assertThat(todayRow.invoiceCount()).as("today's sale is counted").isEqualTo(1);
        assertThat(todayRow.revenue()).isEqualByComparingTo(new BigDecimal("200"));

        // A day with no sales must still be present, as a zero — not missing.
        var quietDay = series.get(0);
        assertThat(quietDay.invoiceCount()).isZero();
        assertThat(quietDay.revenue()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("an inverted or oversized series range is refused with a clear reason")
    void dailySeriesRejectsBadRanges() {
        assertThatThrownBy(() -> reportsService.dailySalesSeries("2026-07-10", "2026-07-01"))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("after the end date");

        assertThatThrownBy(() -> reportsService.dailySalesSeries("2020-01-01", "2026-12-31"))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("Narrow the range");
    }
}
