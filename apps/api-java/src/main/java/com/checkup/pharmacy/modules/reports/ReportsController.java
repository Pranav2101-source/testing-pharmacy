package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.api.ApiResponse;
import com.checkup.pharmacy.modules.reports.dto.CostAnalysisResponse;
import com.checkup.pharmacy.modules.reports.dto.DailySalesResponse;
import com.checkup.pharmacy.modules.reports.dto.DeadStockResponse;
import com.checkup.pharmacy.modules.reports.dto.EodSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ExpiryItemResponse;
import com.checkup.pharmacy.modules.reports.dto.FastMovingResponse;
import com.checkup.pharmacy.modules.reports.dto.GstSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.HsnSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.PurchaseSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ScheduleHItemResponse;
import com.checkup.pharmacy.modules.reports.dto.ValuationResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/** Read-only sales/inventory/purchase/compliance analytics — tenant-scoped, any authenticated staff member. */
@RestController
@RequestMapping("/api/v1/reports")
public class ReportsController {

    private final ReportsService reportsService;

    public ReportsController(ReportsService reportsService) {
        this.reportsService = reportsService;
    }

    @GetMapping("/sales/daily")
    public ApiResponse<DailySalesResponse> dailySales(@RequestParam(required = false) String date) {
        return ApiResponse.ok(reportsService.dailySales(date));
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

    @GetMapping("/purchases/summary")
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

    @GetMapping("/eod/summary")
    public ApiResponse<EodSummaryResponse> eodSummary() {
        return ApiResponse.ok(reportsService.eodSummary());
    }
}
