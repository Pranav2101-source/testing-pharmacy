package com.checkup.pharmacy.modules.platform.dashboard.dto;

import java.time.Instant;
import java.util.List;

/**
 * Platform-admin home dashboard payload. The nested shape is the exact wire
 * contract the frontend's {@code DashboardStats} type expects
 * ({@code real} / {@code metrics} / {@code systemHealth} / {@code criticalAlerts})
 * — any key rename silently breaks {@code PlatformAdminDashboard.tsx}.
 */
public record PlatformStatsResponse(
        RealStats real,
        Financials metrics,
        SystemHealth systemHealth,
        List<Alert> criticalAlerts) {

    public record RealStats(
            long totalPharmacies,
            long activePharmacies,
            long totalDoctors,
            long totalPatients,
            long totalUsers,
            long totalTickets,
            long openTickets,
            long urgentTickets,
            long totalConsultations,
            List<ActivityItem> activityFeed) {
    }

    public record ActivityItem(String id, String type, String message, Instant timestamp) {
    }

    public record Financials(
            long mrr,
            long arr,
            long todaysRevenue,
            long renewalsToday,
            long failedPayments,
            long outstandingInvoices) {
    }

    public record SystemHealth(
            HealthItem database,
            HealthItem redis,
            HealthItem queue,
            HealthItem storage,
            HealthItem api) {
    }

    public record HealthItem(String status, String value, String detail) {
    }

    public record Alert(String id, String type, String message) {
    }
}
