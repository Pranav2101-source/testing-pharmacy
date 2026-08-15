package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.reports.dto.CostAnalysisResponse;
import com.checkup.pharmacy.modules.reports.dto.CustomerInsightsResponse;
import com.checkup.pharmacy.modules.reports.dto.DailySalesResponse;
import com.checkup.pharmacy.modules.reports.dto.DeadStockResponse;
import com.checkup.pharmacy.modules.reports.dto.EodSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ExpiryItemResponse;
import com.checkup.pharmacy.modules.reports.dto.FastMovingResponse;
import com.checkup.pharmacy.modules.reports.dto.Gstr3bResponse;
import com.checkup.pharmacy.modules.reports.dto.GstSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.HsnSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.LapsedCustomersResponse;
import com.checkup.pharmacy.modules.reports.dto.MarginReportResponse;
import com.checkup.pharmacy.modules.reports.dto.PurchaseSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ScheduleHItemResponse;
import com.checkup.pharmacy.modules.reports.dto.ValuationResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/**
 * Read-only sales/inventory/purchase/compliance analytics — tenant-scoped.
 *
 * <p>OWNER/MANAGER by default, applied at the class so a new endpoint is guarded the
 * moment it is written rather than whenever someone remembers.
 *
 * <p>WHY THE CLASS AND NOT THE UI. The web app already treats this whole area as
 * privileged: {@code /dashboard/reports} sits behind a route guard allowing only OWNER and
 * MANAGER, commented "financial data". But that guard lives in the browser, so it stops a
 * cashier opening the screen and stops nothing else — a cashier's own token read the
 * pharmacy's entire stock valuation at cost, its dead-stock exposure and its supplier
 * purchase prices with a single request. The boundary the product already declares now
 * exists on the server as well.
 *
 * <p>Two endpoints are deliberately exempt, each because a screen every role can reach
 * depends on it. They are annotated individually and say which screen — do not "tidy" the
 * exemptions away without moving those callers first, or the Home and Purchase pages break
 * for exactly the roles that have no other view of them. {@code ReportsAuthorizationIT}
 * asserts both directions.
 */
@RestController
@RequestMapping("/api/v1/reports")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class ReportsController {

    private final ReportsService reportsService;

    public ReportsController(ReportsService reportsService) {
        this.reportsService = reportsService;
    }

    @GetMapping("/sales/daily")
    public ApiResponse<DailySalesResponse> dailySales(@RequestParam(required = false) String date) {
        return ApiResponse.ok(reportsService.dailySales(date));
    }

    /**
     * Per-bucket sales totals for a range (YYYY-MM-DD), one row per IST day — or per IST
     * month with {@code groupBy=month} — including buckets with no sales. Exists so the
     * trend chart is a single request instead of one per day.
     *
     * <p>A month bucket's {@code date} is {@code YYYY-MM}. See the service for why the two
     * bucket sizes are separate queries rather than an interpolated format string.
     */
    @GetMapping("/sales/daily-series")
    public ApiResponse<List<DailySalesResponse>> dailySalesSeries(@RequestParam(required = false) String from,
                                                                  @RequestParam(required = false) String to,
                                                                  @RequestParam(required = false) String groupBy) {
        return ApiResponse.ok(reportsService.dailySalesSeries(from, to, groupBy));
    }

    /**
     * Gross margin on the period's sales — revenue net of GST and discounts against the
     * batch cost recorded on each line, plus the medicines sold below cost.
     */
    @GetMapping("/sales/margin")
    public ApiResponse<MarginReportResponse> salesMargin(@RequestParam(required = false) Instant from,
                                                         @RequestParam(required = false) Instant to,
                                                         @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(reportsService.marginReport(from, to, limit));
    }

    /**
     * Who bought in the period, how many were new, and how much of it was anonymous.
     *
     * <p>Grouped by customer id, never by phone — see {@code InvoiceRepository}: numbers
     * carried over from the previous system are shared between family members, so phone
     * grouping would merge a household into one person.
     */
    @GetMapping("/customers")
    public ApiResponse<CustomerInsightsResponse> customerInsights(@RequestParam(required = false) Instant from,
                                                                  @RequestParam(required = false) Instant to,
                                                                  @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(reportsService.customerInsights(from, to, limit));
    }

    /**
     * Regulars who have stopped coming, most valuable first — a call list.
     *
     * <p>Takes no date range on purpose: "has not been in for ninety days" is a fact about
     * today, not about a reporting window.
     */
    @GetMapping("/customers/lapsed")
    public ApiResponse<LapsedCustomersResponse> lapsedCustomers(@RequestParam(required = false) Integer inactiveDays,
                                                                @RequestParam(required = false) Integer minVisits,
                                                                @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(reportsService.lapsedCustomers(inactiveDays, minVisits, limit));
    }

    @GetMapping("/gst")
    public ApiResponse<GstSummaryResponse> gst(@RequestParam(required = false) Instant from,
                                               @RequestParam(required = false) Instant to) {
        return ApiResponse.ok(reportsService.gstSummary(from, to));
    }

    @GetMapping("/expiry")
    public ApiResponse<List<ExpiryItemResponse>> expiry(@RequestParam(required = false) Integer days,
                                                        @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(reportsService.expiryReport(days, limit));
    }

    /**
     * EXEMPT from the class-level OWNER/MANAGER gate — see the class javadoc.
     *
     * <p>Drives the counters at the top of the Purchase page ({@code usePurchaseSummary}),
     * which carries no route guard: pharmacists and cashiers work purchase orders and GRNs,
     * and the draft/overdue/pending-approval counts are the queue they work from.
     *
     * <p>It also returns total purchase spend for the range, which is commercial rather than
     * operational. That is pre-existing behaviour on a screen every role already opens, so
     * it is left as it stands — narrowing it is a product decision about what a cashier
     * should see, not a security fix, and it would blank a figure that page shows today.
     */
    @GetMapping("/purchases/summary")
    @PreAuthorize("isAuthenticated()")
    public ApiResponse<PurchaseSummaryResponse> purchaseSummary(@RequestParam(required = false) Instant from,
                                                                @RequestParam(required = false) Instant to) {
        return ApiResponse.ok(reportsService.purchaseSummary(from, to));
    }

    @GetMapping("/purchases/cost-analysis")
    public ApiResponse<CostAnalysisResponse> costAnalysis(@RequestParam(required = false) Instant from,
                                                          @RequestParam(required = false) Instant to,
                                                          @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(reportsService.costAnalysis(from, to, limit));
    }

    @GetMapping("/schedule-h")
    public ApiResponse<List<ScheduleHItemResponse>> scheduleH(@RequestParam(required = false) Instant from,
                                                              @RequestParam(required = false) Instant to,
                                                              @RequestParam(required = false) String schedule) {
        return ApiResponse.ok(reportsService.scheduleRegister(from, to, schedule));
    }

    /**
     * The figures for a GSTR-3B, table by table.
     *
     * <p>A working sheet, not a return: it reports what the pharmacy documents can support and
     * declares what they cannot, rather than presenting a complete-looking summary with silent
     * holes in it. See the service for what is derived and what is left to the filer.
     */
    @GetMapping("/gst/gstr-3b")
    public ApiResponse<Gstr3bResponse> gstr3b(@RequestParam(required = false) Instant from,
                                              @RequestParam(required = false) Instant to) {
        return ApiResponse.ok(reportsService.gstr3b(from, to));
    }

    @GetMapping("/gst/hsn-summary")
    public ApiResponse<HsnSummaryResponse> hsnSummary(@RequestParam(required = false) Instant from,
                                                      @RequestParam(required = false) Instant to) {
        return ApiResponse.ok(reportsService.hsnSummary(from, to));
    }

    @GetMapping("/analytics/fast-moving")
    public ApiResponse<FastMovingResponse> fastMoving(@RequestParam(required = false) Instant from,
                                                      @RequestParam(required = false) Instant to,
                                                      @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(reportsService.fastMoving(from, to, limit));
    }

    @GetMapping("/analytics/slow-moving")
    public ApiResponse<FastMovingResponse> slowMoving(@RequestParam(required = false) Instant from,
                                                      @RequestParam(required = false) Instant to,
                                                      @RequestParam(required = false) Integer limit,
                                                      @RequestParam(required = false) Integer minQty) {
        return ApiResponse.ok(reportsService.slowMoving(from, to, limit, minQty));
    }

    @GetMapping("/analytics/dead-stock")
    public ApiResponse<DeadStockResponse> deadStock(@RequestParam(required = false) Integer days) {
        return ApiResponse.ok(reportsService.deadStock(days));
    }

    @GetMapping("/inventory/valuation")
    public ApiResponse<ValuationResponse> valuation(@RequestParam(required = false) String groupBy) {
        return ApiResponse.ok(reportsService.inventoryValuation(groupBy));
    }

    /**
     * EXEMPT from the class-level OWNER/MANAGER gate — see the class javadoc.
     *
     * <p>Drives the end-of-day widget on the dashboard Home page, which every role lands on
     * at login. Today's own takings, today's top medicines and the overdue-GRN count are
     * the shop floor's view of its own shift, not the pharmacy's commercial position.
     */
    @GetMapping("/eod/summary")
    @PreAuthorize("isAuthenticated()")
    public ApiResponse<EodSummaryResponse> eodSummary() {
        return ApiResponse.ok(reportsService.eodSummary());
    }
}
