package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.modules.billing.BillingService;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
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
    @Autowired private com.checkup.pharmacy.modules.customer.CustomerRepository customerRepository;
    @Autowired private com.checkup.pharmacy.modules.supplier.SupplierRepository supplierRepository;
    @Autowired private com.checkup.pharmacy.modules.purchase.PurchasesService purchasesService;
    @Autowired private com.checkup.pharmacy.modules.supplierreturn.SupplierReturnsService supplierReturnsService;
    @Autowired private com.checkup.pharmacy.modules.inventory.InventoryService inventoryService;
    @Autowired private PharmacyMedicineOverrideRepository overrideRepository;
    @Autowired private com.checkup.pharmacy.modules.customerledger.CustomerAccountService accountService;
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
        saleVia("CASH", units);
    }

    private String plainCustomer() {
        var customer = customerRepository.save(
                com.checkup.pharmacy.modules.customer.Customer.create(pharmacyId, "Depositor"));
        flushAndClear();
        return customer.getId();
    }

    private void saleVia(String paymentMode, int units) {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, paymentMode, "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO, null))));
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
    @DisplayName("an invoice reconciles from its own stored columns, charges and all")
    void invoiceReconcilesFromStoredColumns() {
        // The identity a tax invoice has to satisfy, and could not before these three
        // columns existed: extraCharges and adjustmentAmount were never written down,
        // so the gap between taxable + GST and the total was unexplainable afterwards.
        var created = billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, new BigDecimal("10"), new BigDecimal("25"), new BigDecimal("-3.50"),
                null, null,
                List.of(new InvoiceItemRequest(batchId, 3, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var invoice = billingService.getInvoice(created.id());

        assertThat(invoice.extraCharges()).isEqualByComparingTo(new BigDecimal("25"));
        assertThat(invoice.adjustmentAmount()).isEqualByComparingTo(new BigDecimal("-3.50"));

        BigDecimal derived = invoice.taxableAmount()
                .add(invoice.totalGst())
                .add(invoice.extraCharges())
                .add(invoice.adjustmentAmount())
                .add(invoice.roundOff());
        assertThat(derived)
                .as("taxable + GST + charges + adjustment + round-off must equal the billed total")
                .isEqualByComparingTo(invoice.totalAmount());
    }

    @Test
    @DisplayName("a bill-level discount reduces the tax, and the two GST reports agree")
    void billDiscountReducesTaxAndReportsReconcile() {
        // The bill discount used to be deducted AFTER the tax, so the pharmacy remitted
        // GST on money it never collected and the invoice did not add up: taxable + GST
        // came from before the discount, totalAmount from after.
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, new BigDecimal("10"), null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var from = Instant.now().minus(1, ChronoUnit.HOURS);
        var to = Instant.now();
        var gst = reportsService.gstSummary(from, to);
        var hsn = reportsService.hsnSummary(from, to);

        // The invoice reconciles on its own terms.
        assertThat(gst._sum().taxableAmount().add(gst._sum().totalGst()))
                .as("taxable + GST must equal the value the customer was billed")
                .isEqualByComparingTo(gst._sum().totalAmount());

        // And the GSTR-1 HSN summary, which sums the stored LINES, agrees with the
        // header the GST summary reads. These are shown side by side on one screen.
        BigDecimal hsnTaxable = hsn.rows().stream().map(r -> r.taxableAmount())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal hsnGst = hsn.rows().stream().map(r -> r.totalGst())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(hsnTaxable).isEqualByComparingTo(gst._sum().taxableAmount());
        assertThat(hsnGst).isEqualByComparingTo(gst._sum().totalGst());
    }

    /**
     * The GST summary's own identity, on an invoice that actually exercises it.
     *
     * <p>The existing reconciliation test uses a bill with no extra charges, no adjustment and
     * a whole-rupee total — so it asserted {@code taxable + GST == net} in exactly the case
     * where nothing else can appear between them. Every real bill carries a round-off at
     * least, and the summary summed neither that nor the two charge columns: the screen showed
     * a taxable value and a tax total that did not add up to the net figure printed beneath
     * them, with no row that could explain the gap.
     */
    @Test
    @DisplayName("the GST summary reconciles on a bill with charges, an adjustment and a round-off")
    void gstSummaryAccountsForChargesAndRounding() {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, new BigDecimal("25"), new BigDecimal("-3.50"), null, null,
                List.of(new InvoiceItemRequest(batchId, 3, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var gst = reportsService.gstSummary(hourAgo(), Instant.now());

        assertThat(gst._sum().extraCharges()).isEqualByComparingTo(new BigDecimal("25.00"));
        assertThat(gst._sum().adjustmentAmount()).isEqualByComparingTo(new BigDecimal("-3.50"));

        assertThat(gst._sum().taxableAmount()
                        .add(gst._sum().totalGst())
                        .add(gst._sum().extraCharges())
                        .add(gst._sum().adjustmentAmount())
                        .add(gst._sum().roundOff()))
                .as("every rupee between the taxable value and the net figure must be on the screen")
                .isEqualByComparingTo(gst._sum().totalAmount());
    }

    /**
     * The two compliance tabs are read side by side and both feed one GSTR-1. They are derived
     * differently — the summary reads invoice headers, the HSN summary sums stored lines — so
     * a multi-line bill is the case where they could drift, and the single-line bill the
     * original test used is the case where they cannot.
     */
    @Test
    @DisplayName("the GST summary and the HSN summary agree on a multi-line bill, to the paisa")
    void gstAndHsnSummariesAgreeOnMultiLineBills() {
        Medicine other = medicineRepository.save(Medicine.create("Paracetamol 650", new BigDecimal("12")));
        String otherBatch = inventoryRepository.save(Inventory.create(pharmacyId, other.getId(), "BATCH-2",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("11.00"), new BigDecimal("33.33"), 10, 5)).getId();
        Medicine third = medicineRepository.save(Medicine.create("ORS Sachet", new BigDecimal("5")));
        String thirdBatch = inventoryRepository.save(Inventory.create(pharmacyId, third.getId(), "BATCH-3",
                Instant.now().plus(365, ChronoUnit.DAYS), 100,
                new BigDecimal("7.00"), new BigDecimal("17.77"), 10, 5)).getId();
        flushAndClear();

        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, new BigDecimal("7.5"), null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 3, null, new BigDecimal("5"), null),
                        new InvoiceItemRequest(otherBatch, 7, null, BigDecimal.ZERO, null),
                        new InvoiceItemRequest(thirdBatch, 11, null, new BigDecimal("2.5"), null))));
        flushAndClear();

        var gst = reportsService.gstSummary(hourAgo(), Instant.now());
        var hsn = reportsService.hsnSummary(hourAgo(), Instant.now());

        BigDecimal hsnTaxable = hsn.rows().stream().map(r -> r.taxableAmount())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal hsnCgst = hsn.rows().stream().map(r -> r.cgst()).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal hsnSgst = hsn.rows().stream().map(r -> r.sgst()).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal hsnGst = hsn.rows().stream().map(r -> r.totalGst()).reduce(BigDecimal.ZERO, BigDecimal::add);

        assertThat(hsnTaxable)
                .as("the invoice header must BE the sum of its lines, not merely close to it")
                .isEqualByComparingTo(gst._sum().taxableAmount());
        assertThat(hsnCgst).isEqualByComparingTo(gst._sum().cgst());
        assertThat(hsnSgst).isEqualByComparingTo(gst._sum().sgst());
        assertThat(hsnGst).isEqualByComparingTo(gst._sum().totalGst());
        assertThat(gst._sum().cgst())
                .as("and CGST must still equal SGST — the split is per line, so summing preserves it")
                .isEqualByComparingTo(gst._sum().sgst());
    }

    @Test
    @DisplayName("the GST summary reports IGST separately, so the figures reconcile")
    void gstSummaryReportsIgst() {
        // An interstate sale stores the whole tax as IGST with CGST and SGST at zero.
        // The summary omitted IGST entirely, so such a sale showed 0 + 0 against a
        // non-zero Total GST — three numbers a GSTR-1 return cannot be built from.
        interstateSale(2);

        var summary = reportsService.gstSummary(Instant.now().minus(1, ChronoUnit.HOURS), Instant.now());

        assertThat(summary._sum().igst()).isGreaterThan(BigDecimal.ZERO);
        assertThat(summary._sum().cgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(summary._sum().sgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(summary._sum().cgst().add(summary._sum().sgst()).add(summary._sum().igst()))
                .as("the breakdown must add up to the headline figure")
                .isEqualByComparingTo(summary._sum().totalGst());
    }

    @Test
    @DisplayName("the HSN summary groups in SQL and still totals every line")
    void hsnSummaryGroupsByHsnAndRate() {
        cashSale(2);
        cashSale(3); // same medicine, same HSN and rate — must collapse into one row

        var summary = reportsService.hsnSummary(Instant.now().minus(1, ChronoUnit.HOURS), Instant.now());

        assertThat(summary.rows()).hasSize(1);
        var row = summary.rows().get(0);
        assertThat(row.totalQty()).isEqualTo(5);
        assertThat(row.totalGst()).isEqualByComparingTo(row.cgst().add(row.sgst()).add(row.igst()));
        assertThat(row.taxableAmount()).isGreaterThan(BigDecimal.ZERO);
    }

    private void interstateSale(int units) {
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                true, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO, null))));
        flushAndClear();
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
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(otherBatch, 5, null, BigDecimal.ZERO, null))));
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
    @DisplayName("stock valuation excludes stock that is already past its expiry date")
    void valuationExcludesExpiredStock() {
        // The seeded batch (BATCH-1, expires in 365 days) is live and must be valued.
        // A second batch of the same medicine, already expired, cannot be sold and so must
        // not inflate what the shelves are worth — it is surfaced by the expiry report instead.
        inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "EXPIRED-VAL-1",
                Instant.now().minus(3, ChronoUnit.DAYS), 40,
                new BigDecimal("50.00"), new BigDecimal("100.00"), 10, 5));
        flushAndClear();

        var valuation = reportsService.inventoryValuation("medicine");

        // Only BATCH-1's 100 packs: cost 5,000 / retail 10,000. The expired 40 packs are gone.
        assertThat(valuation.totalCostValue()).isEqualByComparingTo(new BigDecimal("5000.00"));
        assertThat(valuation.totalRetailValue()).isEqualByComparingTo(new BigDecimal("10000.00"));
    }

    @Test
    @DisplayName("purchase cost analysis: the table is a top-N but 'total purchased' is every rupee")
    void costAnalysisTotalCoversTheWholePeriodNotJustTheTable() {
        var supplier = supplierRepository.save(
                com.checkup.pharmacy.modules.supplier.Supplier.create(pharmacyId, "Bulk Distributor"));
        flushAndClear();
        // Three distinct medicines received; ask for a table of only the top 1.
        for (int i = 0; i < 3; i++) {
            Medicine m = medicineRepository.save(Medicine.create("CA Med " + i, new BigDecimal("12")));
            var grn = purchasesService.createGrn(new com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest(
                    supplier.getId(), null, "CA-INV-" + i + "-" + unique(), Instant.now(), null,
                    List.of(new com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest(
                            m.getId(), null, "CA Med " + i, null, null, null, null, null, null, null, "CA-B" + i,
                            Instant.now().plus(365, ChronoUnit.DAYS), 10, 10, 0, null, null,
                            new BigDecimal("100.00"), new BigDecimal("150.00"), BigDecimal.ZERO, new BigDecimal("12"))),
                    false, null));
            purchasesService.confirmGrn(grn.id());
            flushAndClear();
        }

        var report = reportsService.costAnalysis(hourAgo(), Instant.now(), 1);

        assertThat(report.items()).as("table truncated to the single biggest spend").hasSize(1);
        BigDecimal tableSum = report.items().stream()
                .map(com.checkup.pharmacy.modules.reports.dto.CostAnalysisResponse.Item::totalCost)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(report.summary().totalCost())
                .as("summary covers all 3 receipts (10 units x 100 + 12% landed), not just the one row shown")
                .isEqualByComparingTo(new BigDecimal("3360.00"));
        assertThat(report.summary().totalCost())
                .as("and it exceeds the truncated table's own sum")
                .isGreaterThan(tableSum);
    }

    @Test
    @DisplayName("slow-moving refuses an inverted date range like every other range report")
    void slowMovingRejectsInvertedRange() {
        assertThatThrownBy(() -> reportsService.slowMoving(
                Instant.now(), Instant.now().minus(1, ChronoUnit.DAYS), null, null))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class);
    }

    // ── Payment mix ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("payment mix splits the period's takings by channel and the slices reconcile")
    void paymentMixSplitsTakingsByChannel() {
        saleVia("CASH", 2); // Rs.200
        saleVia("CASH", 1); // Rs.100
        saleVia("UPI", 3);  // Rs.300

        var mix = reportsService.paymentMix(hourAgo(), Instant.now());

        assertThat(mix.bills()).isEqualTo(3);
        assertThat(mix.total()).isEqualByComparingTo(new BigDecimal("600.00"));
        assertThat(mix.slices()).extracting(s -> s.mode()).containsExactlyInAnyOrder("CASH", "UPI");
        var cash = mix.slices().stream().filter(s -> s.mode().equals("CASH")).findFirst().orElseThrow();
        assertThat(cash.amount()).isEqualByComparingTo(new BigDecimal("300.00"));
        assertThat(cash.bills()).isEqualTo(2);
        assertThat(mix.slices().stream().map(s -> s.amount()).reduce(BigDecimal.ZERO, BigDecimal::add))
                .as("slices add up to the headline")
                .isEqualByComparingTo(mix.total());
        assertThat(mix.slices().stream().map(s -> s.sharePct()).reduce(BigDecimal.ZERO, BigDecimal::add))
                .as("shares add up to ~100%")
                .isEqualByComparingTo(new BigDecimal("100.00"));
    }

    @Test
    @DisplayName("a customer deposit does not inflate the payment mix — it answers how today's SELLING was paid for")
    void paymentMixIgnoresDeposits() {
        // Deposits are read by CashClosureService through a separate, deliberately
        // uncombined reader (PaymentMixReader.advanceMovements) for exactly this
        // reason: counting a deposit here as well as counting the bill it later
        // settles would total the same rupees twice and skew every slice's share.
        saleVia("CASH", 2); // Rs.200 of real selling

        accountService.recordAdvance(plainCustomer(),
                new com.checkup.pharmacy.modules.customerledger.dto.RecordAdvanceRequest(
                        new BigDecimal("5000"), "CASH", null, null));
        flushAndClear();

        var mix = reportsService.paymentMix(hourAgo(), Instant.now());

        assertThat(mix.total())
                .as("only the Rs.200 sale — the Rs.5000 deposit is not a sale")
                .isEqualByComparingTo(new BigDecimal("200.00"));
        assertThat(mix.bills()).isEqualTo(1);
    }

    @Test
    @DisplayName("payment mix on a dead period is empty, not a divide-by-zero")
    void paymentMixEmptyPeriodIsSafe() {
        var mix = reportsService.paymentMix(
                Instant.now().minus(400, ChronoUnit.DAYS), Instant.now().minus(399, ChronoUnit.DAYS));
        assertThat(mix.total()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(mix.bills()).isZero();
        assertThat(mix.slices()).isEmpty();
    }

    // ── GST liability trend ──────────────────────────────────────────────────

    @Test
    @DisplayName("the GST trend returns one zero-filled row per month for the trailing window")
    void gstTrendIsZeroFilledPerMonth() {
        cashSale(2);

        var trend = reportsService.gstTrend(6);

        assertThat(trend.months()).hasSize(6);
        assertThat(trend.months()).allSatisfy(m ->
                assertThat(m.month()).as("YYYY-MM, never a fake day").hasSize(7));
        var current = trend.months().get(5);
        assertThat(current.totalGst()).isGreaterThan(BigDecimal.ZERO);
        assertThat(current.totalGst())
                .isEqualByComparingTo(current.cgst().add(current.sgst()).add(current.igst()));
        // A month with no sales is still a row, at zero.
        assertThat(trend.months().get(0).totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(trend.months().get(0).taxable()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("the GST trend buckets a sale into its IST month, not the UTC one")
    void gstTrendBucketsByIstMonth() {
        cashSale(2);
        String invoiceId = onlyInvoiceId();
        // 21:00 UTC on 31 March = 02:30 IST on 1 April.
        setCreatedAt(invoiceId, Instant.parse("2026-03-31T21:00:00Z"));

        // A window wide enough to contain both March and April 2026.
        long monthsBack = java.time.temporal.ChronoUnit.MONTHS.between(
                java.time.YearMonth.of(2026, 3),
                java.time.YearMonth.from(java.time.LocalDate.now(java.time.ZoneOffset.ofHoursMinutes(5, 30)))) + 1;
        var trend = reportsService.gstTrend((int) Math.min(monthsBack, 36));

        var april = trend.months().stream().filter(m -> m.month().equals("2026-04")).findFirst().orElseThrow();
        var march = trend.months().stream().filter(m -> m.month().equals("2026-03")).findFirst().orElseThrow();
        assertThat(april.totalGst()).as("02:30 IST 1 April belongs to April").isGreaterThan(BigDecimal.ZERO);
        assertThat(march.totalGst()).as("and not to March").isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("the GST trend never reaches across pharmacies")
    void gstTrendIsTenantScoped() {
        cashSale(2);
        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9000000021", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        var trend = reportsService.gstTrend(3);
        assertThat(trend.months()).allSatisfy(m -> assertThat(m.totalGst()).isEqualByComparingTo(BigDecimal.ZERO));
    }

    // ── Customer trend ───────────────────────────────────────────────────────

    @Test
    @DisplayName("the customer trend splits new from returning on whole history, per IST month")
    void customerTrendSplitsNewFromReturning() {
        String regular = createCustomer("Trend Regular", "9700000001");
        String firstTimer = createCustomer("Trend Newbie", "9700000002");

        // The regular's first bill is months in the past; a second bill lands this month.
        setCreatedAt(saleTo(regular, 1), Instant.now().minus(70, ChronoUnit.DAYS));
        saleTo(regular, 1);
        // The first-timer's only bill is this month.
        saleTo(firstTimer, 1);

        var trend = reportsService.customerTrend(6);
        assertThat(trend.months()).hasSize(6);

        var thisMonth = trend.months().get(5);
        assertThat(thisMonth.billed()).as("both customers billed this month").isEqualTo(2);
        assertThat(thisMonth.newCount()).as("only the first-timer is new").isEqualTo(1);
        assertThat(thisMonth.returning()).isEqualTo(1);
        assertThat(thisMonth.billed()).isEqualTo(thisMonth.newCount() + thisMonth.returning());
    }

    @Test
    @DisplayName("the customer trend zero-fills quiet months and never crosses pharmacies")
    void customerTrendZeroFillsAndIsScoped() {
        createAndSellTo("Only Ours", "9700000003", 1);

        var mine = reportsService.customerTrend(4);
        assertThat(mine.months()).hasSize(4);
        assertThat(mine.months().get(0).billed()).as("a quiet month is still a row at zero").isZero();

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9000000022", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);
        var theirs = reportsService.customerTrend(4);
        assertThat(theirs.months()).allSatisfy(m -> assertThat(m.billed()).isZero());
    }

    // ── Dead stock bounding ──────────────────────────────────────────────────

    @Test
    @DisplayName("dead stock caps the list at the limit but the headline total covers every batch")
    void deadStockBoundsTheListNotTheTotal() {
        // The seeded BATCH-1 (100 packs @ Rs.50 = Rs.5,000) plus two more dead batches.
        inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "DEAD-2",
                Instant.now().plus(200, ChronoUnit.DAYS), 10, new BigDecimal("30.00"),
                new BigDecimal("60.00"), 10, 5));
        inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "DEAD-3",
                Instant.now().plus(200, ChronoUnit.DAYS), 5, new BigDecimal("20.00"),
                new BigDecimal("40.00"), 10, 5));
        flushAndClear();

        var report = reportsService.deadStock(90, 1);

        assertThat(report.items()).as("list capped at 1").hasSize(1);
        assertThat(report.items().get(0).batchNumber()).as("and it is the biggest exposure").isEqualTo("BATCH-1");
        assertThat(report.totalCostAtRisk())
                .as("headline is 5,000 + 300 + 100 across all three, not just the one shown")
                .isEqualByComparingTo(new BigDecimal("5400.00"));
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

        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, prescription.getId(), "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 1, null, BigDecimal.ZERO, null))));
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

    /**
     * Pins the IST day boundary against a sale whose timestamp we choose, rather than "now".
     *
     * <p>The test above could not catch the bug this one exists for. It creates a sale at the
     * current instant and asks whether it lands on today, so the wrong grouping and the right
     * one agree for most of the day and disagree only once the clock passes midnight IST —
     * a suite that is green until roughly 00:00 and red until 05:30, which reads as flakiness
     * and gets re-run rather than investigated. Choosing the timestamp removes the clock from
     * the assertion entirely.
     *
     * <p>Two instants, either side of an IST midnight, both written directly because no API
     * lets a caller backdate an invoice:
     *
     * <ul>
     *   <li>18:29:59Z — 23:59:59 IST, the last second of the earlier IST day</li>
     *   <li>18:30:01Z — 00:00:01 IST, the first second of the next one</li>
     * </ul>
     *
     * <p>They are 2 seconds apart and must land on DIFFERENT bars. Under the old
     * single-argument conversion both fell on the earlier date, because it shifted -5:30
     * instead of +5:30 — so a pharmacy's whole morning was billed to the previous day.
     */
    @Test
    @DisplayName("the day boundary is IST midnight, not UTC midnight")
    void dailySeriesBucketsByIstMidnight() {
        cashSale(1);
        String invoiceId = (String) entityManager
                .createNativeQuery("SELECT id FROM invoices WHERE \"pharmacyId\" = :p LIMIT 1")
                .setParameter("p", pharmacyId)
                .getSingleResult();
        flushAndClear();

        // 2026-03-10T18:29:59Z = 23:59:59 IST on the 10th; one second later is the 11th.
        java.time.Instant lateOnTheTenth = java.time.Instant.parse("2026-03-10T18:29:59Z");
        java.time.Instant earlyOnTheEleventh = java.time.Instant.parse("2026-03-10T18:30:01Z");

        setCreatedAt(invoiceId, lateOnTheTenth);
        assertThat(dayOf(invoiceId, "2026-03-09", "2026-03-12"))
                .as("23:59:59 IST belongs to that IST day, not the next")
                .isEqualTo("2026-03-10");

        setCreatedAt(invoiceId, earlyOnTheEleventh);
        assertThat(dayOf(invoiceId, "2026-03-09", "2026-03-12"))
                .as("00:00:01 IST belongs to the new IST day — two seconds later, a different bar")
                .isEqualTo("2026-03-11");
    }

    /** Backdates an invoice. Native, because no API may rewrite when a sale happened. */
    private void setCreatedAt(String invoiceId, java.time.Instant at) {
        entityManager.createNativeQuery(
                        "UPDATE invoices SET \"createdAt\" = :at WHERE id = :id")
                .setParameter("at", java.sql.Timestamp.from(at))
                .setParameter("id", invoiceId)
                .executeUpdate();
        flushAndClear();
    }

    /** The single populated bar in the window — which IST day the series put the sale on. */
    private String dayOf(String invoiceId, String from, String to) {
        return reportsService.dailySalesSeries(from, to).stream()
                .filter(d -> d.invoiceCount() > 0)
                .map(d -> d.date())
                .findFirst()
                .orElseThrow(() -> new AssertionError("the sale fell outside the queried window"));
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

    // ── Month bucketing ──────────────────────────────────────────────────────

    @Test
    @DisplayName("grouping by month collapses a long range into one bar per IST month")
    void monthlySeriesBucketsByMonth() {
        // A year grouped by day is 365 bars in a chart sized for seven — the whole reason
        // the bucket parameter exists. Twelve months must come back as twelve rows.
        var series = reportsService.dailySalesSeries("2026-01-01", "2026-12-31", "month");

        assertThat(series).hasSize(12);
        assertThat(series.get(0).date()).isEqualTo("2026-01");
        assertThat(series.get(11).date()).isEqualTo("2026-12");
        assertThat(series).allSatisfy(point ->
                assertThat(point.date()).as("a month bucket is YYYY-MM, never a fake day").hasSize(7));
    }

    @Test
    @DisplayName("a sale lands in its own IST month, and empty months are still plotted")
    void monthlySeriesPlacesSaleAndFillsGaps() {
        cashSale(2);
        String invoiceId = onlyInvoiceId();
        // 21:00 UTC on 31 March is 02:30 IST on 1 April — the boundary where a naive UTC
        // bucket would file April's takings under March, and a whole month would be wrong.
        setCreatedAt(invoiceId, Instant.parse("2026-03-31T21:00:00Z"));

        var series = reportsService.dailySalesSeries("2026-02-01", "2026-05-31", "month");

        assertThat(series).extracting(d -> d.date()).containsExactly("2026-02", "2026-03", "2026-04", "2026-05");
        assertThat(series.get(2).invoiceCount())
                .as("02:30 IST on 1 April belongs to April, not to March")
                .isEqualTo(1);
        assertThat(series.get(1).invoiceCount()).as("March had no sales but is still a bar").isZero();
        assertThat(series.get(2).revenue()).isEqualByComparingTo(new BigDecimal("200"));
    }

    @Test
    @DisplayName("a range too wide even for month buckets is refused, and day buckets say so")
    void monthlySeriesBoundsItsOwnRange() {
        assertThatThrownBy(() -> reportsService.dailySalesSeries("2020-01-01", "2026-12-31", "month"))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("months");

        // The day-bucket refusal now points at the way out rather than just refusing.
        assertThatThrownBy(() -> reportsService.dailySalesSeries("2020-01-01", "2026-12-31", "day"))
                .isInstanceOf(com.checkup.pharmacy.common.exception.BadRequestException.class)
                .hasMessageContaining("group by month");
    }

    @Test
    @DisplayName("an unrecognised groupBy falls back to days rather than failing the report")
    void unknownGroupByFallsBackToDays() {
        // A busier chart is a far better outcome than a 400 on a report screen.
        var series = reportsService.dailySalesSeries("2026-03-01", "2026-03-07", "fortnight");
        assertThat(series).hasSize(7);
        assertThat(series.get(0).date()).isEqualTo("2026-03-01");
    }

    // ── Gross margin ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("gross margin is measured against cost, net of the GST the pharmacy only collects")
    void marginExcludesGstAndUsesRecordedCost() {
        cashSale(2); // 2 @ MRP 100 (18% inclusive), batch cost 50

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        // Rs.200 billed is Rs.169.49 of revenue and Rs.30.51 of tax. Counting the tax as
        // revenue would report ~50% margin on a sale that actually earned 41%.
        assertThat(margin.revenueExGst()).isEqualByComparingTo(new BigDecimal("169.49"));
        assertThat(margin.cogs()).isEqualByComparingTo(new BigDecimal("100.00"));
        assertThat(margin.grossProfit()).isEqualByComparingTo(new BigDecimal("69.49"));
        assertThat(margin.marginPct()).isEqualByComparingTo(new BigDecimal("41.00"));
        assertThat(margin.unitsSold()).isEqualTo(2);
    }

    @Test
    @DisplayName("gross profit reconciles: revenue minus cost, on the totals and on every row")
    void marginRowsReconcileWithTheTotal() {
        cashSale(3);

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.revenueExGst().subtract(margin.cogs()))
                .as("the headline must be its own two components")
                .isEqualByComparingTo(margin.grossProfit());
        assertThat(margin.topContributors()).isNotEmpty();
        assertThat(margin.topContributors()).allSatisfy(item ->
                assertThat(item.revenueExGst().subtract(item.cogs())).isEqualByComparingTo(item.grossProfit()));
        assertThat(margin.topContributors().get(0).medicine().name()).isEqualTo("Amoxicillin 250");
        assertThat(margin.topContributors().get(0).batchNumber()).isEqualTo("BATCH-1");
    }

    @Test
    @DisplayName("free goods cost money even though they earn none")
    void freeGoodsAreCostedAgainstMargin() {
        // Stock leaves the shelf as quantity + freeQty, so costing only the charged units
        // would report a scheme-heavy month as more profitable than it was.
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, 1, BigDecimal.ZERO, null))));
        flushAndClear();

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.cogs())
                .as("3 units left the shelf at Rs.50 each — the free one was not free to buy")
                .isEqualByComparingTo(new BigDecimal("150.00"));
        assertThat(margin.grossProfit()).isEqualByComparingTo(new BigDecimal("19.49"));
    }

    @Test
    @DisplayName("selling below cost surfaces as a loss maker, not as a top seller")
    void belowCostSalesAppearInTheLossList() {
        // A 60% discount on a line costing half its MRP puts it under water. Without this
        // list the medicine simply looks popular.
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, null, new BigDecimal("60"), null))));
        flushAndClear();

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.grossProfit()).isNegative();
        assertThat(margin.lossMakers()).hasSize(1);
        var loss = margin.lossMakers().get(0);
        assertThat(loss.medicine().name()).isEqualTo("Amoxicillin 250");
        assertThat(loss.grossProfit()).isNegative();
        assertThat(loss.marginPct()).isNegative();
    }

    @Test
    @DisplayName("a restocked return reverses its margin; a write-off keeps the cost")
    void returnsAdjustMarginByDisposition() {
        cashSale(4);
        String invoiceId = onlyInvoiceId();
        String lineId = onlyInvoiceItemId(invoiceId);

        var beforeReturn = reportsService.marginReport(hourAgo(), Instant.now(), null);

        billingService.createReturn(invoiceId, new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest(
                "Customer changed mind",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(lineId, 1, "RESTOCK")),
                null));
        flushAndClear();

        var afterRestock = reportsService.marginReport(hourAgo(), Instant.now(), null);

        // The unit came back to the shelf: the pharmacy loses the sale's margin, not its cost.
        assertThat(afterRestock.returns().restockedCost()).isEqualByComparingTo(new BigDecimal("50.00"));
        assertThat(afterRestock.returns().writtenOffCost()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(afterRestock.returns().unitsReturned()).isEqualTo(1);
        assertThat(afterRestock.grossProfit())
                .as("one unit of margin reversed, no more")
                .isLessThan(beforeReturn.grossProfit());
        assertThat(afterRestock.cogs())
                .as("restocked cost comes back out of COGS")
                .isEqualByComparingTo(new BigDecimal("150.00"));

        billingService.createReturn(invoiceId, new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest(
                "Damaged strip",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(lineId, 1, "WRITEOFF")),
                null));
        flushAndClear();

        var afterWriteOff = reportsService.marginReport(hourAgo(), Instant.now(), null);

        // Refunded AND destroyed: the revenue goes but the cost stays charged, so this
        // hurts more than the restock did. Netting the two would have hidden that.
        assertThat(afterWriteOff.returns().writtenOffCost()).isEqualByComparingTo(new BigDecimal("50.00"));
        assertThat(afterWriteOff.cogs())
                .as("written-off stock is not recovered, so its cost is still carried")
                .isEqualByComparingTo(new BigDecimal("150.00"));
        assertThat(beforeReturn.grossProfit().subtract(afterRestock.grossProfit()))
                .as("a write-off costs the pharmacy more than a restock of the same unit")
                .isLessThan(afterRestock.grossProfit().subtract(afterWriteOff.grossProfit()));
    }

    @Test
    @DisplayName("an uncosted line is declared rather than counted as pure profit")
    void uncostedLinesAreReportedAsSuch() {
        // Anything migrated from the old system has no purchase rate. Such a line reads as
        // 100% margin, so the report has to say how much of the period it can actually cost.
        String freeBatch = inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "NO-COST",
                Instant.now().plus(365, ChronoUnit.DAYS), 50,
                BigDecimal.ZERO, new BigDecimal("100.00"), 10, 5)).getId();
        flushAndClear();
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(freeBatch, 1, null, BigDecimal.ZERO, null))));
        flushAndClear();
        cashSale(1); // one properly costed line alongside it

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.dataQuality().linesMissingCost()).isEqualTo(1);
        assertThat(margin.dataQuality().totalLines()).isEqualTo(2);
        assertThat(margin.dataQuality().revenueMissingCost()).isEqualByComparingTo(new BigDecimal("84.75"));
        assertThat(margin.dataQuality().costedRevenuePct())
                .as("half the revenue has a real cost behind it, and the report says so")
                .isEqualByComparingTo(new BigDecimal("50.00"));
        assertThat(margin.lossMakers())
                .as("a missing cost is missing data, not a loss — it must not pollute the worklist")
                .isEmpty();
    }

    @Test
    @DisplayName("a period with no sales reports zero margin rather than dividing by zero")
    void emptyPeriodIsSafe() {
        var margin = reportsService.marginReport(
                Instant.now().minus(400, ChronoUnit.DAYS), Instant.now().minus(399, ChronoUnit.DAYS), null);

        assertThat(margin.revenueExGst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(margin.grossProfit()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(margin.marginPct()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(margin.dataQuality().costedRevenuePct()).isEqualByComparingTo(new BigDecimal("100.00"));
        assertThat(margin.topContributors()).isEmpty();
        assertThat(margin.lossMakers()).isEmpty();
    }

    @Test
    @DisplayName("the margin report never reaches across pharmacies")
    void marginIsTenantScoped() {
        cashSale(2);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9000000001", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.revenueExGst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(margin.topContributors()).isEmpty();
    }

    @Test
    @DisplayName("cut-strip sales are broken out from the rest of the period's revenue")
    void looseSalesAreBrokenOutSeparately() {
        cashSale(2); // an ordinary whole-pack sale — must not leak into the loose figure

        String looseMedicineId = seedLooseMedicine();
        String looseBatchId = seedLooseBatch(looseMedicineId);
        flushAndClear();
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(looseBatchId, 8, null, BigDecimal.ZERO, null, "LOOSE"))));
        flushAndClear();

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.looseSales()).isNotNull();
        assertThat(margin.looseSales().piecesSold()).isEqualTo(8);
        assertThat(margin.looseSales().billCount()).isEqualTo(1);
        assertThat(margin.looseSales().lineCount()).isEqualTo(1);
        // 8 tablets at a per-piece MRP of Rs.2.00 (Rs.20/strip of 10), 12% GST-inclusive.
        assertThat(margin.looseSales().revenueExGst()).isEqualByComparingTo(new BigDecimal("14.29"));
        // The whole-pack sale's Rs.169.49 must not be folded into the loose figure.
        assertThat(margin.looseSales().revenueExGst()).isLessThan(margin.revenueExGst());
    }

    @Test
    @DisplayName("the HSN summary folds a loose line to a pack-equivalent, not raw pieces")
    void hsnSummaryFoldsLooseToPackEquivalent() {
        String looseMedicineId = seedLooseMedicine();
        String looseBatchId = seedLooseBatch(looseMedicineId);
        flushAndClear();

        // 2 whole packs + 8 loose tablets of the SAME medicine (strip of 10).
        // Raw, that would total 10 "units" (2 + 8). Folded, it is 2 + 0.8 = 2.8 -> 3
        // strips — the unit valuation and every prior GSTR-1 filing use, not a mix.
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(looseBatchId, 2, null, BigDecimal.ZERO, null))));
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(looseBatchId, 8, null, BigDecimal.ZERO, null, "LOOSE"))));
        flushAndClear();

        var summary = reportsService.hsnSummary(hourAgo(), Instant.now());
        assertThat(summary.rows()).hasSize(1); // one (HSN, rate) group — same medicine both times
        assertThat(summary.rows().get(0).totalQty())
                .as("2 packs + 0.8 pack-equivalent, rounded — not 2 + 8 raw pieces")
                .isEqualTo(3);
    }

    @Test
    @DisplayName("a period with nothing sold loose reports no loose-sales figure at all")
    void looseSalesIsNullWhenNoneSold() {
        cashSale(2);

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.looseSales()).isNull();
    }

    @Test
    @DisplayName("a loose line's cost of goods converts per piece, not per pack")
    void looseLineCostsPerPieceNotPerPack() {
        // purchaseRate 10.00 is for the WHOLE strip of 10 — per-piece cost is 1.00. Storing
        // the pack rate against a piece quantity would report Rs.80 of cost for 8 tablets
        // that actually cost the pharmacy Rs.8.
        String looseMedicineId = seedLooseMedicine();
        String looseBatchId = seedLooseBatch(looseMedicineId);
        flushAndClear();
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(looseBatchId, 8, null, BigDecimal.ZERO, null, "LOOSE"))));
        flushAndClear();

        var margin = reportsService.marginReport(hourAgo(), Instant.now(), null);

        assertThat(margin.cogs()).isEqualByComparingTo(new BigDecimal("8.00"));
    }

    @Test
    @DisplayName("valuation and dead-stock price a batch's loose remainder, not just its sealed packs")
    void looseRemainderIsValuedNotIgnored() {
        // Down to nothing but 8 loose tablets from a 10-pack strip: MRP 20.00/purchaseRate
        // 10.00 per pack means those 8 tablets are worth Rs.16.00 retail / Rs.8.00 cost —
        // not zero, which is what reading `quantity` (0 packs) alone would report.
        String looseMedicineId = seedLooseMedicine();
        Inventory looseOnly = Inventory.create(pharmacyId, looseMedicineId, "LOOSE-REMAINDER-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 0,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
        looseOnly.restockLoose(8);
        inventoryRepository.save(looseOnly);
        flushAndClear();

        var deadStock = reportsService.deadStock(90);
        var deadItem = deadStock.items().stream()
                .filter(i -> i.medicine() != null && i.medicine().name().equals("Paracetamol 500"))
                .findFirst().orElseThrow(() -> new AssertionError("loose-remainder batch missing from dead-stock —"
                        + " a batch with 0 packs must still be visible when it has a loose remainder"));
        assertThat(deadItem.quantity()).isEqualTo(0);
        assertThat(deadItem.looseUnits()).isEqualTo(8);
        assertThat(deadItem.costAtRisk()).isEqualByComparingTo(new BigDecimal("8.00"));
        assertThat(deadItem.retailValue()).isEqualByComparingTo(new BigDecimal("16.00"));

        var valuation = reportsService.inventoryValuation(null);
        var valuationItem = valuation.items().stream()
                .filter(i -> i.medicineName().equals("Paracetamol 500"))
                .findFirst().orElseThrow(() -> new AssertionError("loose-remainder batch missing from valuation"));
        assertThat(valuationItem.costValue()).isEqualByComparingTo(new BigDecimal("8.00"));
        assertThat(valuationItem.retailValue()).isEqualByComparingTo(new BigDecimal("16.00"));
    }

    @Test
    @DisplayName("a batch down to just a loose remainder still counts toward the dashboard's low-stock and expiry alerts")
    void looseRemainderStillTriggersDashboardAlerts() {
        String looseMedicineId = seedLooseMedicine();
        // 0 packs, 4 loose tablets, minimumStock 10 — clearly "low", and expiring next week.
        Inventory lowLoose = Inventory.create(pharmacyId, looseMedicineId, "LOOSE-LOW-1",
                Instant.now().plus(7, ChronoUnit.DAYS), 0,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
        lowLoose.restockLoose(4);
        inventoryRepository.save(lowLoose);
        flushAndClear();

        var stats = billingService.getDashboardStats();

        assertThat(stats.lowStockCount()).isGreaterThanOrEqualTo(1);
        assertThat(stats.nearExpiryCount()).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("fast-moving sums a medicine's pack and loose sales in one coherent unit: pieces")
    void fastMovingNormalizesPacksAndLooseToPieces() {
        // 1 whole strip (10 pieces) sold as a PACK line, plus 3 loose tablets sold separately
        // on the SAME medicine in the same period. Summing the raw `quantity` columns would
        // read "4 sold" (1 pack + 3 pieces) — meaningless. The correct answer is 13 pieces.
        String looseMedicineId = seedLooseMedicine();
        String looseBatchId = seedLooseBatch(looseMedicineId);
        flushAndClear();
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(looseBatchId, 1, null, BigDecimal.ZERO, null, "PACK"))));
        flushAndClear();
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(looseBatchId, 3, null, BigDecimal.ZERO, null, "LOOSE"))));
        flushAndClear();

        var fastMoving = reportsService.fastMoving(hourAgo(), Instant.now(), null);

        var row = fastMoving.items().stream()
                .filter(i -> i.medicine() != null && i.medicine().name().equals("Paracetamol 500"))
                .findFirst().orElseThrow();
        assertThat(row.qtySold()).isEqualTo(13);
    }

    /** A second, loose-capable medicine (10 tablets/strip) — the shared seed medicine is pack-only. */
    private String seedLooseMedicine() {
        Medicine medicine = Medicine.create("Paracetamol 500", new BigDecimal("12"));
        medicine.setPackaging(10, "TABLET");
        medicineRepository.save(medicine);

        PharmacyMedicineOverride override = PharmacyMedicineOverride.create(pharmacyId, medicine.getId());
        override.setAllowLooseSale(true);
        overrideRepository.save(override);
        return medicine.getId();
    }

    private String seedLooseBatch(String medicineId) {
        // 10 packs @ MRP 20.00 => 100 pieces, per-piece MRP 2.00.
        return inventoryRepository.save(Inventory.create(pharmacyId, medicineId, "LOOSE-BATCH-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 10,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5)).getId();
    }

    // ── Customer analytics ───────────────────────────────────────────────────

    @Test
    @DisplayName("new and returning are decided on the customer's whole history, not the range")
    void customerInsightsSplitsNewFromReturning() {
        String regular = createCustomer("Lakshmi", "9800000001");
        String firstTimer = createCustomer("Suresh", "9800000002");

        // The regular's first bill is well before the window under report.
        String oldInvoice = saleTo(regular, 1);
        setCreatedAt(oldInvoice, Instant.now().minus(200, ChronoUnit.DAYS));
        saleTo(regular, 2);
        saleTo(firstTimer, 1);

        var insights = reportsService.customerInsights(hourAgo(), Instant.now(), null);

        assertThat(insights.customersBilled()).isEqualTo(2);
        assertThat(insights.newCustomers())
                .as("only Suresh is new — Lakshmi first bought 200 days ago")
                .isEqualTo(1);
        assertThat(insights.returningCustomers()).isEqualTo(1);
        assertThat(insights.repeatRatePct()).isEqualByComparingTo(new BigDecimal("50.00"));
    }

    @Test
    @DisplayName("walk-in bills are declared, not folded into the customer figures")
    void walkInBillsAreReportedSeparately() {
        // Every customer figure counts identified customers only, so a pharmacy billing
        // mostly anonymously would read as having almost no customers at all.
        createAndSellTo("Anita", "9800000003", 1);
        cashSale(1); // no customer attached
        cashSale(1);

        var insights = reportsService.customerInsights(hourAgo(), Instant.now(), null);

        assertThat(insights.customersBilled()).isEqualTo(1);
        assertThat(insights.walkIns().bills()).isEqualTo(2);
        assertThat(insights.walkIns().sharePct())
                .as("two of three bills had nobody attached")
                .isEqualByComparingTo(new BigDecimal("66.67"));
    }

    @Test
    @DisplayName("top customers rank by what they spent, with their current name and phone")
    void topCustomersRankBySpend() {
        createAndSellTo("Big Spender", "9800000004", 4);
        createAndSellTo("Small Spender", "9800000005", 1);

        var insights = reportsService.customerInsights(hourAgo(), Instant.now(), null);

        assertThat(insights.topCustomers()).hasSize(2);
        var top = insights.topCustomers().get(0);
        assertThat(top.name()).isEqualTo("Big Spender");
        assertThat(top.phone()).isEqualTo("9800000004");
        assertThat(top.revenue()).isEqualByComparingTo(new BigDecimal("400"));
        assertThat(top.bills()).isEqualTo(1);
        assertThat(insights.topCustomers().get(1).name()).isEqualTo("Small Spender");
    }

    @Test
    @DisplayName("a regular gone quiet appears on the call list; a recent one and a one-off do not")
    void lapsedListFindsRegularsWhoStopped() {
        String lapsed = createCustomer("Gone Quiet", "9800000006");
        String active = createCustomer("Still Coming", "9800000007");
        String oneOff = createCustomer("Passer By", "9800000008");

        // Two visits, both long past — the case worth a phone call.
        setCreatedAt(saleTo(lapsed, 2), Instant.now().minus(200, ChronoUnit.DAYS));
        setCreatedAt(saleTo(lapsed, 3), Instant.now().minus(150, ChronoUnit.DAYS));
        // A regular who is still around.
        setCreatedAt(saleTo(active, 2), Instant.now().minus(200, ChronoUnit.DAYS));
        saleTo(active, 1);
        // One ancient visit — a stranger, not a customer who left.
        setCreatedAt(saleTo(oneOff, 1), Instant.now().minus(300, ChronoUnit.DAYS));

        var report = reportsService.lapsedCustomers(90, 2, null);

        assertThat(report.items()).hasSize(1);
        var item = report.items().get(0);
        assertThat(item.name()).isEqualTo("Gone Quiet");
        assertThat(item.phone()).isEqualTo("9800000006");
        assertThat(item.totalBills()).isEqualTo(2);
        assertThat(item.lifetimeRevenue()).isEqualByComparingTo(new BigDecimal("500"));
        assertThat(item.daysSinceLastVisit()).isBetween(148L, 152L);
        assertThat(report.valueAtRisk()).isEqualByComparingTo(new BigDecimal("500"));
    }

    @Test
    @DisplayName("minVisits is what keeps one-time strangers out of the call list")
    void lapsedListHonoursMinVisits() {
        String oneOff = createCustomer("Passer By", "9800000009");
        setCreatedAt(saleTo(oneOff, 1), Instant.now().minus(300, ChronoUnit.DAYS));

        assertThat(reportsService.lapsedCustomers(90, 2, null).items())
                .as("a single visit is not a customer who left")
                .isEmpty();
        assertThat(reportsService.lapsedCustomers(90, 1, null).items())
                .as("asked for everyone, they show up")
                .hasSize(1);
    }

    @Test
    @DisplayName("customer reports never reach across pharmacies")
    void customerReportsAreTenantScoped() {
        createAndSellTo("Ours", "9800000010", 2);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9000000002", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        assertThat(reportsService.customerInsights(hourAgo(), Instant.now(), null).customersBilled()).isZero();
        assertThat(reportsService.lapsedCustomers(1, 1, null).items()).isEmpty();
    }

    private String createCustomer(String name, String phone) {
        var customer = com.checkup.pharmacy.modules.customer.Customer.create(pharmacyId, name);
        customer.applyFields(name, phone, null, null, null, null, null, null, null,
                com.checkup.pharmacy.common.enums.CustomerType.WALK_IN, BigDecimal.ZERO, BigDecimal.ZERO, null);
        String id = customerRepository.save(customer).getId();
        flushAndClear();
        return id;
    }

    /** A sale attributed to a customer. Returns the invoice id so it can be backdated. */
    private String saleTo(String customerId, int units) {
        var created = billingService.createInvoice(new CreateInvoiceRequest(customerId, null, null, null, null, null,
                "CASH", "PAID", null, null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, units, null, BigDecimal.ZERO, null))));
        flushAndClear();
        return created.id();
    }

    private void createAndSellTo(String name, String phone, int units) {
        saleTo(createCustomer(name, phone), units);
    }

    // ── GSTR-3B ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("outward supplies are reported net of the credit notes raised in the period")
    void gstr3bNetsOffCreditNotes() {
        // GSTR-3B Table 3.1 is filed net of credit notes. Without the deduction the pharmacy
        // declares — and pays tax on — money it handed back.
        cashSale(4);
        String invoiceId = onlyInvoiceId();
        String lineId = onlyInvoiceItemId(invoiceId);

        var before = reportsService.gstr3b(hourAgo(), Instant.now());

        billingService.createReturn(invoiceId, new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest(
                "Customer changed mind",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(lineId, 1, "RESTOCK")),
                null));
        flushAndClear();

        var after = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(before.outwardSupplies().taxableOutward().taxableValue())
                .isEqualByComparingTo(new BigDecimal("338.98"));
        assertThat(after.outwardSupplies().creditNotes().taxableValue())
                .as("the credit note is reported in its own right, not just silently deducted")
                .isEqualByComparingTo(new BigDecimal("84.75"));
        assertThat(after.outwardSupplies().taxableOutward().taxableValue())
                .as("3.1(a) drops by exactly the credit note")
                .isEqualByComparingTo(new BigDecimal("254.23"));
        assertThat(after.outwardSupplies().taxableOutward().cgst())
                .isLessThan(before.outwardSupplies().taxableOutward().cgst());
    }

    @Test
    @DisplayName("a nil-rated line lands in 3.1(c), not 3.1(a) — even on the same bill")
    void gstr3bSplitsNilRatedFromTaxable() {
        // A pharmacy routinely sells a 12% medicine and a nil-rated one on one bill. Splitting
        // on the invoice rather than the line would tip the whole bill into whichever bucket
        // its first line happened to fall in.
        Medicine nilRated = medicineRepository.save(Medicine.create("Nil Rated Syrup", BigDecimal.ZERO));
        String nilBatch = inventoryRepository.save(Inventory.create(pharmacyId, nilRated.getId(), "NIL-1",
                Instant.now().plus(365, ChronoUnit.DAYS), 50,
                new BigDecimal("20.00"), new BigDecimal("40.00"), 10, 5)).getId();
        flushAndClear();

        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, null, BigDecimal.ZERO, null),
                        new InvoiceItemRequest(nilBatch, 3, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.outwardSupplies().taxableOutward().taxableValue())
                .as("the 18% line only")
                .isEqualByComparingTo(new BigDecimal("169.49"));
        assertThat(report.outwardSupplies().nilRatedExempt().taxableValue())
                .as("3 x 40 at nil rate carries no tax to extract")
                .isEqualByComparingTo(new BigDecimal("120.00"));
        assertThat(report.outwardSupplies().nilRatedExempt().cgst()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    @DisplayName("the tables this system cannot fill are declared, not left looking complete")
    void gstr3bDeclaresWhatItCannotKnow() {
        // A tax summary that silently omits what it cannot see is worse than one that says so:
        // once the numbers are on the page the gaps are invisible.
        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.outwardSupplies().zeroRated().taxableValue()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(report.outwardSupplies().reverseCharge().taxableValue()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(report.dataQuality().untrackedNotes())
                .anySatisfy(n -> assertThat(n).contains("reverse charge"))
                .anySatisfy(n -> assertThat(n).contains("unregistered"));
        assertThat(report.dataQuality().gstinMissing())
                .as("the seeded pharmacy has no GSTIN, and nothing can be filed without one")
                .isTrue();
        assertThat(report.dataQuality().stateMissing()).isTrue();
    }

    @Test
    @DisplayName("a supplier with no state is declared, because the misclassification check is blind to it")
    void gstr3bDeclaresSuppliersWithoutState() {
        // The flagged-receipt list compares supplier state against pharmacy state. A supplier
        // with neither cannot be flagged, so an empty list would read as "all clean" when the
        // truth is "cannot tell". On a tax return those must not look the same.
        supplierRepository.save(com.checkup.pharmacy.modules.supplier.Supplier.create(pharmacyId, "No State Traders"));
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.dataQuality().suppliersWithoutState()).isEqualTo(1);
        assertThat(report.dataQuality().suppliersTotal()).isEqualTo(1);
        assertThat(report.dataQuality().misclassifiedGrns())
                .as("nothing can be flagged — which is exactly why the count above must be shown")
                .isEmpty();
        assertThat(report.dataQuality().untrackedNotes())
                .anySatisfy(n -> assertThat(n).contains("no state recorded"));
    }

    @Test
    @DisplayName("input credit comes from confirmed receipts only, and a debit note reverses it")
    void gstr3bInputCreditFollowsConfirmedReceipts() {
        var supplier = supplierRepository.save(
                com.checkup.pharmacy.modules.supplier.Supplier.create(pharmacyId, "Local Distributor"));
        flushAndClear();

        var grn = purchasesService.createGrn(new com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest(
                supplier.getId(), null, "SUP-INV-1", Instant.now(), null,
                List.of(new com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest(
                        medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, "GRN-B1",
                        Instant.now().plus(365, ChronoUnit.DAYS), 10, 10, 0, null, null,
                        new BigDecimal("100.00"), new BigDecimal("150.00"), BigDecimal.ZERO,
                        new BigDecimal("18"))),
                false, null));
        flushAndClear();

        var draftStage = reportsService.gstr3b(hourAgo(), Instant.now());
        assertThat(draftStage.inputTaxCredit().allOtherItc().cgst())
                .as("a draft GRN is stock the pharmacy has not accepted — no credit yet")
                .isEqualByComparingTo(BigDecimal.ZERO);

        purchasesService.confirmGrn(grn.id());
        flushAndClear();

        var confirmed = reportsService.gstr3b(hourAgo(), Instant.now());
        // 10 x 100 = 1000 at 18% intra-state = 90 CGST + 90 SGST.
        assertThat(confirmed.inputTaxCredit().allOtherItc().cgst()).isEqualByComparingTo(new BigDecimal("90.00"));
        assertThat(confirmed.inputTaxCredit().allOtherItc().sgst()).isEqualByComparingTo(new BigDecimal("90.00"));
        assertThat(confirmed.inputTaxCredit().allOtherItc().igst())
                .as("a local supplier attracts no IGST")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(confirmed.inputTaxCredit().netAvailable().cgst()).isEqualByComparingTo(new BigDecimal("90.00"));
    }

    /**
     * A debit note that has only been drafted, or that was abandoned, must not reverse
     * anything. Both used to.
     *
     * <p>A supplier return computes and STORES its tax at creation and then sits in DRAFT;
     * {@code cancel()} only flips the status and leaves those columns populated. So Table
     * 4(B) reversed credit for goods still on the shelf and for debit notes somebody had
     * explicitly given up on — understating net ITC and making the pharmacy pay the
     * difference in cash.
     */
    @Test
    @DisplayName("only a CONFIRMED debit note reverses input credit — a draft or a cancelled one does not")
    void gstr3bReversesOnlyConfirmedDebitNotes() {
        String supplierId = confirmedPurchase();

        var afterPurchase = reportsService.gstr3b(hourAgo(), Instant.now());
        assertThat(afterPurchase.inputTaxCredit().allOtherItc().cgst()).isEqualByComparingTo(new BigDecimal("90.00"));
        assertThat(afterPurchase.inputTaxCredit().reversedOther().cgst())
                .as("nothing has been sent back yet")
                .isEqualByComparingTo(BigDecimal.ZERO);

        String draftReturn = draftSupplierReturn(supplierId, 2);

        var withDraft = reportsService.gstr3b(hourAgo(), Instant.now());
        assertThat(withDraft.inputTaxCredit().reversedOther().cgst())
                .as("a DRAFT debit note is goods still on the shelf — it reverses nothing")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(withDraft.inputTaxCredit().netAvailable().cgst()).isEqualByComparingTo(new BigDecimal("90.00"));

        supplierReturnsService.cancel(draftReturn);
        flushAndClear();

        assertThat(reportsService.gstr3b(hourAgo(), Instant.now()).inputTaxCredit().reversedOther().cgst())
                .as("a CANCELLED debit note never happened — cancel() leaves the tax columns populated, "
                        + "so only the status filter keeps it out")
                .isEqualByComparingTo(BigDecimal.ZERO);

        // And the one that actually goes back does reverse, under the head it was claimed under.
        supplierReturnsService.confirm(draftSupplierReturn(supplierId, 2));
        flushAndClear();

        var confirmed = reportsService.gstr3b(hourAgo(), Instant.now());
        // 2 x 100 = 200 at 18% intra-state = 18 CGST + 18 SGST.
        assertThat(confirmed.inputTaxCredit().reversedOther().cgst()).isEqualByComparingTo(new BigDecimal("18.00"));
        assertThat(confirmed.inputTaxCredit().reversedOther().sgst()).isEqualByComparingTo(new BigDecimal("18.00"));
        assertThat(confirmed.inputTaxCredit().netAvailable().cgst())
                .as("4(C) is 4(A)(5) less 4(B)")
                .isEqualByComparingTo(new BigDecimal("72.00"));
    }

    /**
     * The reversal has to land in the period the goods went back, not the period somebody
     * started typing the debit note — because the CLAIM side is dated on when the goods
     * were accepted. Keyed on createdAt, a return drafted in one month and confirmed in
     * the next reversed a credit that had not been claimed yet.
     */
    @Test
    @DisplayName("a debit note reverses in the period it was confirmed, not the period it was drafted")
    void gstr3bReversalIsDatedByConfirmation() {
        String supplierId = confirmedPurchase();
        String returnId = draftSupplierReturn(supplierId, 2);

        // Drafted well in the past, confirmed now.
        backdateSupplierReturn(returnId, Instant.now().minus(40, ChronoUnit.DAYS));
        supplierReturnsService.confirm(returnId);
        flushAndClear();

        Instant windowStart = Instant.now().minus(45, ChronoUnit.DAYS);
        Instant draftedWindowEnd = Instant.now().minus(30, ChronoUnit.DAYS);

        assertThat(reportsService.gstr3b(windowStart, draftedWindowEnd).inputTaxCredit().reversedOther().cgst())
                .as("the month it was DRAFTED in must not carry the reversal")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(reportsService.gstr3b(hourAgo(), Instant.now()).inputTaxCredit().reversedOther().cgst())
                .as("the month it was CONFIRMED in does")
                .isEqualByComparingTo(new BigDecimal("18.00"));
    }

    /**
     * The dead store this pins: {@code SupplierReturn.create} assigned the computed IGST and
     * then overwrote it with zero on the very next line. The service had already been fixed to
     * derive inter-state tax from the supplier's state, so the bug hid behind a correct-looking
     * call site — and what got stored was 0/0/0 against a non-zero totalGst, a debit note whose
     * own breakdown did not add up and which reversed nothing in Table 4(B).
     */
    @Test
    @DisplayName("an inter-state debit note reverses IGST, not nothing at all")
    void gstr3bInterstateDebitNoteReversesIgst() {
        setPharmacyState("Tamil Nadu");
        var supplier = com.checkup.pharmacy.modules.supplier.Supplier.create(pharmacyId, "Maharashtra Distributor");
        supplier.applyFields("Maharashtra Distributor", null, null, null, null, null, null,
                "Maharashtra", BigDecimal.ZERO, 0, null);
        supplierRepository.save(supplier);
        flushAndClear();

        supplierReturnsService.confirm(draftSupplierReturn(supplier.getId(), 2));
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.inputTaxCredit().reversedOther().igst())
                .as("an out-of-state return reverses the head it was claimed under")
                .isEqualByComparingTo(new BigDecimal("36.00"));
        assertThat(report.inputTaxCredit().reversedOther().cgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(report.inputTaxCredit().reversedOther().sgst()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    /**
     * A purchase return is a 4(B)(2) reversal, never a 4(B)(1) one.
     *
     * <p>4(B)(1) is rules 38/42/43 and section 17(5) — credit that was never yours. A purchase
     * return is not that: the credit was valid and is being unwound because the goods went back,
     * which is why 4(B)(2) is reclaimable through 4(D)(1) and 4(B)(1) is not. One combined row
     * left the filer guessing the split.
     */
    @Test
    @DisplayName("a debit note reverses under 4(B)(2), leaving 4(B)(1) for section 17(5)")
    void gstr3bSplitsReversalIntoItsTwoStatutoryHalves() {
        String supplierId = confirmedPurchase();
        supplierReturnsService.confirm(draftSupplierReturn(supplierId, 2));
        flushAndClear();

        var itc = reportsService.gstr3b(hourAgo(), Instant.now()).inputTaxCredit();

        assertThat(itc.reversedOther().cgst()).isEqualByComparingTo(new BigDecimal("18.00"));
        assertThat(itc.reversedSection17().cgst())
                .as("nothing was destroyed — a return is not a section 17(5) event")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(itc.netAvailable().cgst())
                .as("4(C) nets BOTH halves of 4(B) off 4(A)")
                .isEqualByComparingTo(new BigDecimal("72.00"));
    }

    /**
     * The credit behind Table 4(B)(1), which this system cannot derive automatically because
     * whether a specific expired batch has actually been disposed of (the write-off flow that
     * sets {@code BatchStatus.EXPIRED} and records an {@code EXPIRY_REMOVAL} movement) is a
     * pharmacist decision — this batch, seeded straight past its expiry date, has not been
     * through it. Reporting 4(B)(1) as a bare nil would read
     * as "nothing to reverse"; the exposure is reported instead so the filer can act on it.
     */
    @Test
    @DisplayName("expired stock still on the books is reported with the credit trapped in it")
    void gstr3bReportsExpiredStockExposure() {
        Medicine expiring = medicineRepository.save(Medicine.create("Expired Tonic", new BigDecimal("12")));
        // 20 units at Rs.50 cost = Rs.1000, 12% of which is Rs.120 of credit already claimed.
        inventoryRepository.save(Inventory.create(pharmacyId, expiring.getId(), "OLD-1",
                Instant.now().minus(10, ChronoUnit.DAYS), 20,
                new BigDecimal("50.00"), new BigDecimal("90.00"), 10, 5));
        flushAndClear();

        var quality = reportsService.gstr3b(hourAgo(), Instant.now()).dataQuality();

        assertThat(quality.expiredStock().batches()).isEqualTo(1);
        assertThat(quality.expiredStock().units()).isEqualTo(20);
        assertThat(quality.expiredStock().cost()).isEqualByComparingTo(new BigDecimal("1000.00"));
        assertThat(quality.expiredStock().embeddedItc())
                .as("section 17(5)(h) blocks this credit, and it has never been reversed")
                .isEqualByComparingTo(new BigDecimal("120.00"));
        assertThat(quality.untrackedNotes())
                .anySatisfy(n -> assertThat(n).contains("17(5)(h)"));
    }

    @Test
    @DisplayName("expired stock exposure prices a loose remainder too, not just sealed packs")
    void gstr3bExpiredStockIncludesLooseRemainder() {
        String looseMedicineId = seedLooseMedicine();
        // 2 sealed packs (10 tablets each) + 4 loose tablets, all expired 10 days ago.
        // Pack rate 10.00 => per-piece 1.00. Cost = 2*10.00 + 4*1.00 = 24.00. Units (pieces) = 2*10+4 = 24.
        Inventory expiredLoose = Inventory.create(pharmacyId, looseMedicineId, "EXPIRED-LOOSE-1",
                Instant.now().minus(10, ChronoUnit.DAYS), 2,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
        expiredLoose.restockLoose(4);
        inventoryRepository.save(expiredLoose);
        flushAndClear();

        var quality = reportsService.gstr3b(hourAgo(), Instant.now()).dataQuality();

        assertThat(quality.expiredStock().batches()).isEqualTo(1);
        assertThat(quality.expiredStock().units()).isEqualTo(24);
        assertThat(quality.expiredStock().cost()).isEqualByComparingTo(new BigDecimal("24.00"));
        // 12% GST on Rs.24.00 of cost.
        assertThat(quality.expiredStock().embeddedItc()).isEqualByComparingTo(new BigDecimal("2.88"));
    }

    @Test
    @DisplayName("a batch down to just a loose remainder still counts as expired-stock exposure")
    void gstr3bExpiredStockVisibleWithNoSealedPacksLeft() {
        String looseMedicineId = seedLooseMedicine();
        Inventory looseOnlyExpired = Inventory.create(pharmacyId, looseMedicineId, "EXPIRED-LOOSE-ONLY-1",
                Instant.now().minus(10, ChronoUnit.DAYS), 0,
                new BigDecimal("10.00"), new BigDecimal("20.00"), 10, 5);
        looseOnlyExpired.restockLoose(4);
        inventoryRepository.save(looseOnlyExpired);
        flushAndClear();

        var quality = reportsService.gstr3b(hourAgo(), Instant.now()).dataQuality();

        assertThat(quality.expiredStock().batches())
                .as("a batch with 0 sealed packs but a real loose remainder must not be invisible")
                .isEqualTo(1);
        assertThat(quality.expiredStock().units()).isEqualTo(4);
        assertThat(quality.expiredStock().cost()).isEqualByComparingTo(new BigDecimal("4.00"));
    }

    /**
     * The whole point of building the write-off: expiry becomes a dated disposal event, so
     * Table 4(B)(1) can finally be derived instead of being a declared nil.
     */
    @Test
    @DisplayName("writing expired stock off moves its blocked credit out of the exposure and into 4(B)(1)")
    void gstr3bDerivesSection17ReversalFromWriteOffs() {
        Medicine expiring = medicineRepository.save(Medicine.create("Expired Tonic", new BigDecimal("12")));
        String batch = inventoryRepository.save(Inventory.create(pharmacyId, expiring.getId(), "OLD-3",
                Instant.now().minus(10, ChronoUnit.DAYS), 20,
                new BigDecimal("50.00"), new BigDecimal("90.00"), 10, 5)).getId();
        flushAndClear();

        var before = reportsService.gstr3b(hourAgo(), Instant.now());
        assertThat(before.inputTaxCredit().reversedSection17().cgst())
                .as("not written off yet, so nothing is reversible")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(before.dataQuality().expiredStock().embeddedItc())
                .isEqualByComparingTo(new BigDecimal("120.00"));

        var result = inventoryService.writeOffExpired(
                new com.checkup.pharmacy.modules.inventory.dto.WriteOffExpiredRequest(
                        List.of(batch), "Destroyed as per expiry disposal"));
        flushAndClear();

        assertThat(result.batchesWrittenOff()).isEqualTo(1);
        assertThat(result.unitsWrittenOff()).isEqualTo(20);
        assertThat(result.costWrittenOff()).isEqualByComparingTo(new BigDecimal("1000.00"));
        assertThat(result.itcToReverse()).isEqualByComparingTo(new BigDecimal("120.00"));

        var after = reportsService.gstr3b(hourAgo(), Instant.now());
        // Rs.120 of blocked credit, split into equal CGST and SGST halves.
        assertThat(after.inputTaxCredit().reversedSection17().cgst()).isEqualByComparingTo(new BigDecimal("60.00"));
        assertThat(after.inputTaxCredit().reversedSection17().sgst()).isEqualByComparingTo(new BigDecimal("60.00"));
        assertThat(after.inputTaxCredit().reversedSection17().taxableValue())
                .as("Table 4 has no taxable-value column, and 4(C) nets this field — putting the "
                        + "write-off COST here made 4(C) report a taxable value of minus that cost")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(after.dataQuality().expiredStock().batches())
                .as("and it is no longer sitting on the books as an un-actioned exposure")
                .isZero();
    }

    /** A purchase return already reverses through 4(B)(2); it must not be counted again in 4(B)(1). */
    @Test
    @DisplayName("a supplier return does not leak into the section 17(5) reversal")
    void gstr3bDoesNotDoubleCountSupplierReturnsAsDisposals() {
        String supplierId = confirmedPurchase();
        supplierReturnsService.confirm(draftSupplierReturn(supplierId, 2));
        flushAndClear();

        var itc = reportsService.gstr3b(hourAgo(), Instant.now()).inputTaxCredit();

        assertThat(itc.reversedSection17().cgst())
                .as("confirming a supplier return writes an ADJUSTMENT/OUT movement — reading those "
                        + "as disposals would reverse the same rupees in 4(B)(1) and 4(B)(2) at once")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(itc.reversedOther().cgst()).isEqualByComparingTo(new BigDecimal("18.00"));
    }

    /**
     * Dated at the END of the period, not today. A batch that expired last week was still good
     * stock during a month that closed before it — its credit was not reversible then, and
     * asking today's question of a closed month would overstate the reversal.
     */
    @Test
    @DisplayName("expired stock is judged as at the period end, not as at today")
    void gstr3bExpiredStockIsAsAtPeriodEnd() {
        Medicine expiring = medicineRepository.save(Medicine.create("Recently Expired", new BigDecimal("12")));
        inventoryRepository.save(Inventory.create(pharmacyId, expiring.getId(), "OLD-2",
                Instant.now().minus(5, ChronoUnit.DAYS), 20,
                new BigDecimal("50.00"), new BigDecimal("90.00"), 10, 5));
        flushAndClear();

        var closedMonth = reportsService.gstr3b(
                Instant.now().minus(40, ChronoUnit.DAYS), Instant.now().minus(30, ChronoUnit.DAYS));

        assertThat(closedMonth.dataQuality().expiredStock().batches())
                .as("it had not expired yet when that period closed")
                .isZero();
        assertThat(reportsService.gstr3b(hourAgo(), Instant.now()).dataQuality().expiredStock().batches())
                .as("but it has now")
                .isEqualTo(1);
    }

    /** A confirmed 10-unit receipt at Rs.100 + 18% from a local supplier. Returns the supplier id. */
    private String confirmedPurchase() {
        var supplier = supplierRepository.save(
                com.checkup.pharmacy.modules.supplier.Supplier.create(pharmacyId, "Local Distributor"));
        flushAndClear();
        var grn = purchasesService.createGrn(new com.checkup.pharmacy.modules.purchase.dto.CreateGrnRequest(
                supplier.getId(), null, "SUP-INV-" + unique(), Instant.now(), null,
                List.of(new com.checkup.pharmacy.modules.purchase.dto.GrnItemRequest(
                        medicineId, null, "Amoxicillin 250", null, null, null, null, null, null, null, "GRN-B1",
                        Instant.now().plus(365, ChronoUnit.DAYS), 10, 10, 0, null, null,
                        new BigDecimal("100.00"), new BigDecimal("150.00"), BigDecimal.ZERO,
                        new BigDecimal("18"))),
                false, null));
        flushAndClear();
        purchasesService.confirmGrn(grn.id());
        flushAndClear();
        return supplier.getId();
    }

    /**
     * A DRAFT debit note for {@code units} at Rs.100 + 18%. Returns its id.
     *
     * <p>The debit-note number is unique per call on purpose: {@code create} runs through
     * DuplicateSubmitGuard, which fingerprints the request body, so two byte-identical
     * drafts inside its ten-second window would be rejected as a double submit. A test
     * that needs two drafts must make them genuinely different documents.
     */
    private String draftSupplierReturn(String supplierId, int units) {
        var created = supplierReturnsService.create(
                new com.checkup.pharmacy.modules.supplierreturn.dto.CreateSupplierReturnRequest(
                        supplierId, "DN-" + unique(), null,
                        List.of(new com.checkup.pharmacy.modules.supplierreturn.dto.SupplierReturnItemRequest(
                                batchId, medicineId, "Amoxicillin 250", "BATCH-1",
                                Instant.now().plus(365, ChronoUnit.DAYS), units,
                                new BigDecimal("100.00"), new BigDecimal("18"), null))));
        flushAndClear();
        return created.id();
    }

    private void backdateSupplierReturn(String returnId, Instant at) {
        entityManager.createNativeQuery(
                        "UPDATE supplier_returns SET \"createdAt\" = :at WHERE id = :id")
                .setParameter("at", at).setParameter("id", returnId)
                .executeUpdate();
        flushAndClear();
    }

    private void setPharmacyState(String state) {
        var pharmacy = pharmacyRepository.findById(pharmacyId).orElseThrow();
        pharmacy.setState(state);
        pharmacyRepository.save(pharmacy);
        flushAndClear();
    }

    /**
     * The portal validates that 3.2 is a subset of 3.1(a) and rejects a return where it is not.
     *
     * <p>3.2 used to be read from invoice-level columns while 3.1(a) was summed from lines with
     * a rate on them, so a mixed bill pushed nil-rated value into 3.2 that 3.1(a) never carried.
     * Both now come from the same lines.
     */
    @Test
    @DisplayName("3.2 never exceeds 3.1(a), even on a bill mixing taxable and nil-rated lines")
    void gstr3bPlaceOfSupplyIsASubsetOfTaxableOutward() {
        setPharmacyState("Tamil Nadu");
        String customerId = customerInState("Kerala Patient", "Kerala");

        Medicine nilRated = medicineRepository.save(Medicine.create("Nil Rated Syrup", BigDecimal.ZERO));
        String nilBatch = inventoryRepository.save(Inventory.create(pharmacyId, nilRated.getId(), "NIL-POS",
                Instant.now().plus(365, ChronoUnit.DAYS), 50,
                new BigDecimal("20.00"), new BigDecimal("40.00"), 10, 5)).getId();
        flushAndClear();

        billingService.createInvoice(new CreateInvoiceRequest(customerId, null, null, null, null, null, "CASH", "PAID", null,
                null, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, null, BigDecimal.ZERO, null),
                        new InvoiceItemRequest(nilBatch, 3, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        BigDecimal posTotal = report.interstateToUnregistered().stream()
                .map(r -> r.taxableValue()).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(report.interstateToUnregistered()).hasSize(1);
        assertThat(report.interstateToUnregistered().get(0).state()).isEqualTo("Kerala");
        assertThat(posTotal)
                .as("only the 18% line belongs in 3.2 — the nil-rated one is 3.1(c)")
                .isEqualByComparingTo(new BigDecimal("169.49"));
        assertThat(posTotal)
                .as("3.2 is declared as a subset of 3.1(a); the portal rejects a return where it is not")
                .isLessThanOrEqualTo(report.outwardSupplies().taxableOutward().taxableValue());
    }

    /** 3.1(a) is filed net of credit notes, so its subset must be too, or 3.2 grows past it. */
    @Test
    @DisplayName("a credit note reduces 3.2 as well as 3.1(a)")
    void gstr3bPlaceOfSupplyIsNettedByCreditNotes() {
        setPharmacyState("Tamil Nadu");
        String customerId = customerInState("Kerala Patient", "Kerala");
        saleTo(customerId, 4);

        String invoiceId = onlyInvoiceId();
        billingService.createReturn(invoiceId, new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest(
                "Customer changed mind",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(
                        onlyInvoiceItemId(invoiceId), 1, "RESTOCK")),
                null));
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.interstateToUnregistered()).hasSize(1);
        assertThat(report.interstateToUnregistered().get(0).taxableValue())
                .as("3 units remain after the credit note, not 4")
                .isEqualByComparingTo(new BigDecimal("254.23"));
        assertThat(report.interstateToUnregistered().get(0).taxableValue())
                .isLessThanOrEqualTo(report.outwardSupplies().taxableOutward().taxableValue());
    }

    /**
     * An inter-state sale with nobody to attribute it to used to disappear from 3.2 entirely
     * — an INNER join plus a {@code state <> ''} test — while its IGST stayed in 3.1(a). The
     * two then could not be reconciled, and nothing said why.
     */
    @Test
    @DisplayName("an inter-state supply with no place of supply is declared, not dropped")
    void gstr3bDeclaresInterstateWithoutPlaceOfSupply() {
        // No pharmacy state, so the client's own interstate flag is what classifies the bill —
        // and there is no customer at all to read a place of supply from.
        billingService.createInvoice(new CreateInvoiceRequest(null, null, null, null, null, null, "CASH", "PAID", null,
                true, null, null, null, null, null, null, null,
                List.of(new InvoiceItemRequest(batchId, 2, null, BigDecimal.ZERO, null))));
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.interstateToUnregistered()).hasSize(1);
        assertThat(report.interstateToUnregistered().get(0).state())
                .as("null is the 'could not be determined' bucket — the row must still exist")
                .isNull();
        assertThat(report.dataQuality().interstateWithoutPlaceOfSupply())
                .isEqualByComparingTo(new BigDecimal("169.49"));
        assertThat(report.dataQuality().untrackedNotes())
                .anySatisfy(n -> assertThat(n).contains("place of supply"));
    }

    /**
     * GSTR-3B cannot be filed with a negative 3.1 — the portal rejects it, and the excess is
     * meant to carry into the next period. The netting could go below zero and was rendered
     * as a negative figure that nobody could enter.
     */
    @Test
    @DisplayName("credit notes exceeding sales floor 3.1 to nil and declare the carry-forward")
    void gstr3bFloorsNegativeOutwardAndDeclaresIt() {
        cashSale(4);
        String invoiceId = onlyInvoiceId();
        String lineId = onlyInvoiceItemId(invoiceId);

        // The sale is pushed out of the REPORTING window while staying inside the pharmacy's
        // 30-day sales-return window — a bill raised last month and returned this one, which
        // is the ordinary shape of this rather than a contrived one. Backdating further would
        // make the return itself illegal and test nothing.
        backdateInvoice(invoiceId, Instant.now().minus(20, ChronoUnit.DAYS));
        billingService.createReturn(invoiceId, new com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest(
                "Returned next month",
                List.of(new com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest(lineId, 4, "RESTOCK")),
                null));
        flushAndClear();

        // A window that contains the credit note but not the sale it reverses.
        var report = reportsService.gstr3b(Instant.now().minus(10, ChronoUnit.DAYS), Instant.now());

        assertThat(report.outwardSupplies().taxableOutward().taxableValue())
                .as("floored — a negative supply cannot be filed")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(report.outwardSupplies().taxableOutward().cgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(report.dataQuality().carryForward().taxableValue())
                .as("and what was floored away is reported, not silently dropped")
                .isEqualByComparingTo(new BigDecimal("338.98"));
        assertThat(report.dataQuality().carryForward().cgst()).isGreaterThan(BigDecimal.ZERO);
        assertThat(report.dataQuality().untrackedNotes())
                .anySatisfy(n -> assertThat(n).contains("carry"));
    }

    /**
     * Every compliance query filters out cancelled invoices, and nothing bounds how old an
     * invoice may be when it is cancelled. So a filed period can quietly change value. The
     * sheet cannot prevent that; it can refuse to be silent about it.
     */
    @Test
    @DisplayName("a bill cancelled after its period closed is flagged, because a filed return no longer matches")
    void gstr3bFlagsCancellationsAfterThePeriodClosed() {
        cashSale(4);
        String invoiceId = onlyInvoiceId();
        backdateInvoice(invoiceId, Instant.now().minus(40, ChronoUnit.DAYS));

        Instant periodStart = Instant.now().minus(45, ChronoUnit.DAYS);
        Instant periodEnd = Instant.now().minus(30, ChronoUnit.DAYS);

        assertThat(reportsService.gstr3b(periodStart, periodEnd).dataQuality().lateCancellations().count())
                .as("nothing has been cancelled yet")
                .isZero();

        billingService.cancelInvoice(invoiceId, "Entered twice");
        flushAndClear();

        var afterCancel = reportsService.gstr3b(periodStart, periodEnd);
        assertThat(afterCancel.outwardSupplies().taxableOutward().taxableValue())
                .as("the value really has left the period")
                .isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(afterCancel.dataQuality().lateCancellations().count()).isEqualTo(1);
        assertThat(afterCancel.dataQuality().lateCancellations().taxableValue())
                .isEqualByComparingTo(new BigDecimal("338.98"));
        assertThat(afterCancel.dataQuality().untrackedNotes())
                .anySatisfy(n -> assertThat(n).contains("cancelled"));
    }

    @Test
    @DisplayName("a bill cancelled inside its own period is not flagged — it changed nothing anyone filed")
    void gstr3bIgnoresCancellationsInsideThePeriod() {
        cashSale(4);
        billingService.cancelInvoice(onlyInvoiceId(), "Entered twice");
        flushAndClear();

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.dataQuality().lateCancellations().count())
                .as("cancelled before the period ended, so no filed figure ever included it")
                .isZero();
    }

    /** A customer with a state, so a sale to them is classified inter-state and has a place of supply. */
    private String customerInState(String name, String state) {
        var customer = com.checkup.pharmacy.modules.customer.Customer.create(pharmacyId, name);
        // (name, phone, email, address, STATE, dob, gender, abha, card, type, discount, credit, notes)
        customer.applyFields(name, "9000000111", null, null, state, null, null, null, null,
                com.checkup.pharmacy.common.enums.CustomerType.WALK_IN, BigDecimal.ZERO, BigDecimal.ZERO, null);
        String id = customerRepository.save(customer).getId();
        flushAndClear();
        return id;
    }

    private void backdateInvoice(String invoiceId, Instant at) {
        setCreatedAt(invoiceId, at);
        flushAndClear();
    }

    @Test
    @DisplayName("the 3B never reaches across pharmacies")
    void gstr3bIsTenantScoped() {
        cashSale(2);

        Pharmacy other = pharmacyRepository.save(Pharmacy.create("Other Pharmacy", "ph-" + unique()));
        User otherUser = userRepository.save(User.create(other.getId(), "Other Owner",
                "other-" + unique() + "@test.local", "9000000003", "hash", Role.OWNER));
        flushAndClear();
        authenticateAs(otherUser.getId(), other.getId(), Role.OWNER);

        var report = reportsService.gstr3b(hourAgo(), Instant.now());

        assertThat(report.outwardSupplies().taxableOutward().taxableValue()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(report.inputTaxCredit().allOtherItc().cgst()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    private static Instant hourAgo() {
        return Instant.now().minus(1, ChronoUnit.HOURS);
    }

    private String onlyInvoiceId() {
        return (String) entityManager
                .createNativeQuery("SELECT id FROM invoices WHERE \"pharmacyId\" = :p ORDER BY \"createdAt\" DESC LIMIT 1")
                .setParameter("p", pharmacyId)
                .getSingleResult();
    }

    private String onlyInvoiceItemId(String invoiceId) {
        return (String) entityManager
                .createNativeQuery("SELECT id FROM invoice_items WHERE \"invoiceId\" = :i LIMIT 1")
                .setParameter("i", invoiceId)
                .getSingleResult();
    }
}
