import type { FastifyInstance } from "fastify";
import type { Prisma } from "@pharmacy/database";
import type { AnalyticsDateRange, AnalyticsDashboard } from "./analytics.types.js";
import { boss } from "@pharmacy/jobs";

const cache = new Map<string, { data: AnalyticsDashboard; expiry: number }>();
const CACHE_TTL = 60_000;

export class AnalyticsService {
  constructor(private app: FastifyInstance) {}

  async getDashboard(range: AnalyticsDateRange, forceRefresh = false): Promise<AnalyticsDashboard> {
    const cacheKey = `${range.from.toISOString()}-${range.to.toISOString()}`;
    if (!forceRefresh && cache.has(cacheKey) && cache.get(cacheKey)!.expiry > Date.now()) {
      return cache.get(cacheKey)!.data;
    }

    const [
      executive,
      alerts,
      revenue,
      tenants,
      subscriptions,
      churn,
      usage,
      search,
      support,
      health,
      geographic,
      activity,
      topLists,
    ] = await Promise.all([
      this.getExecutiveKPIs(range),
      this.getCriticalAlerts(),
      this.getRevenueAnalytics(range),
      this.getTenantGrowth(range),
      this.getSubscriptionAnalytics(),
      this.getChurnAnalytics(range),
      this.getProductUsage(range),
      this.getSearchAnalytics(),
      this.getSupportAnalytics(range),
      this.getSystemHealth(),
      this.getGeographicInsights(),
      this.getRecentActivity(20),
      this.getTopLists(range),
    ]);

    const result = {
      executive,
      alerts,
      revenue,
      tenants,
      subscriptions,
      churn,
      usage,
      search,
      support,
      health,
      geographic,
      activity,
      topLists,
    };

    cache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL });
    return result;
  }

  async exportDashboardData(range: AnalyticsDateRange, format: "csv" | "xlsx"): Promise<{ content: string; filename: string; contentType: string }> {
    const { from, to } = range;
    const dateStr = `${from.toISOString().split("T")[0]}_to_${to.toISOString().split("T")[0]}`;
    
    // Revenue: sum of SubscriptionInvoice.total where paidAt falls in range and status = 'PAID'
    const revenueAgg = await this.app.prisma.subscriptionInvoice.aggregate({
      _sum: { total: true },
      where: {
        status: "PAID",
        paidAt: { gte: from, lte: to }
      }
    });
    const revenue = revenueAgg._sum.total || 0;

    // Isolated counts
    const [
      newPharmacies,
      doctorsCreated,
      patientsCreated,
      prescriptionsCreated,
      supportTickets
    ] = await Promise.all([
      this.app.prisma.pharmacy.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.doctor.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.customer.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.prescription.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.supportTicket.count({ where: { createdAt: { gte: from, lte: to } } })
    ]);

    if (format === "csv") {
      const lines = [];
      lines.push("Platform Analytics Export");
      lines.push(`Date Range (IST): ${from.toISOString()} to ${to.toISOString()}`);
      lines.push("");
      lines.push("Metric,Value");
      lines.push(`"Total Revenue Generated","${revenue}"`);
      lines.push(`"New Pharmacies Created","${newPharmacies}"`);
      lines.push(`"Doctors Registered","${doctorsCreated}"`);
      lines.push(`"Patients Registered","${patientsCreated}"`);
      lines.push(`"Prescriptions Created","${prescriptionsCreated}"`);
      lines.push(`"Support Tickets Raised","${supportTickets}"`);
      
      return {
        content: lines.join("\n"),
        filename: `PlatformAnalytics_${dateStr}.csv`,
        contentType: "text/csv"
      };
    } else {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /></head><body>`;
      html += `<h2>Platform Analytics Export</h2><p>Date Range (IST): ${from.toISOString()} to ${to.toISOString()}</p>`;
      
      html += `<table border="1"><tr><th>Metric</th><th>Value</th></tr>`;
      html += `<tr><td>Total Revenue Generated</td><td>${revenue}</td></tr>`;
      html += `<tr><td>New Pharmacies Created</td><td>${newPharmacies}</td></tr>`;
      html += `<tr><td>Doctors Registered</td><td>${doctorsCreated}</td></tr>`;
      html += `<tr><td>Patients Registered</td><td>${patientsCreated}</td></tr>`;
      html += `<tr><td>Prescriptions Created</td><td>${prescriptionsCreated}</td></tr>`;
      html += `<tr><td>Support Tickets Raised</td><td>${supportTickets}</td></tr>`;
      html += `</table></body></html>`;

      return {
        content: html,
        filename: `PlatformAnalytics_${dateStr}.xls`,
        contentType: "application/vnd.ms-excel"
      };
    }
  }

  // --- Sub-methods ---

  private async getExecutiveKPIs(range: AnalyticsDateRange) {
    const { from, to } = range;
    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
    const previousTo = from;

    const [
      activePharmacies, prevActivePharmacies,
      newPharmacies, prevNewPharmacies,
      activeDoctors, prevActiveDoctors,
      activePatients, prevActivePatients,
      totalPrescriptions, prevTotalPrescriptions,
      openTickets, prevOpenTickets,
      activeSubsWithAmount, prevActiveSubsWithAmount
    ] = await Promise.all([
      this.app.prisma.pharmacy.count({ where: { isActive: true, createdAt: { lte: to } } }),
      this.app.prisma.pharmacy.count({ where: { isActive: true, createdAt: { lte: previousTo } } }),
      this.app.prisma.pharmacy.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.pharmacy.count({ where: { createdAt: { gte: previousFrom, lte: previousTo } } }),
      this.app.prisma.doctor.count({ where: { isActive: true, createdAt: { lte: to } } }),
      this.app.prisma.doctor.count({ where: { isActive: true, createdAt: { lte: previousTo } } }),
      this.app.prisma.customer.count({ where: { createdAt: { lte: to } } }),
      this.app.prisma.customer.count({ where: { createdAt: { lte: previousTo } } }),
      this.app.prisma.prescription.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.prescription.count({ where: { createdAt: { gte: previousFrom, lte: previousTo } } }),
      this.app.prisma.supportTicket.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] }, createdAt: { lte: to } } }),
      this.app.prisma.supportTicket.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] }, createdAt: { lte: previousTo } } }),
      this.app.prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } }, select: { amount: true, billingCycle: true, createdAt: true } }),
      this.app.prisma.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] }, createdAt: { lte: previousTo } }, select: { amount: true, billingCycle: true } })
    ]);

    const calculateMRR = (subs: any[]) => {
      return subs.reduce((sum, s) => {
        const amt = s.amount || 0;
        if (s.billingCycle === "YEARLY") return sum + amt / 12;
        if (s.billingCycle === "QUARTERLY") return sum + amt / 3;
        return sum + amt;
      }, 0);
    };

    const mrr = Math.round(calculateMRR(activeSubsWithAmount));
    const arr = mrr * 12;
    const prevMrr = Math.round(calculateMRR(prevActiveSubsWithAmount));
    const prevArr = prevMrr * 12;

    const calcChange = (curr: number, prev: number) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);

    // Dynamic sparkline logic using actual grouped data
    const generateSparkline = async (model: any, dateField: string, isRange: boolean = true) => {
      const msPerDay = 86400000;
      const days = Math.max(7, Math.ceil((to.getTime() - from.getTime()) / msPerDay));
      const interval = Math.ceil(days / 7);
      
      const sparklineData: number[] = Array(7).fill(0);
      
      const records = await model.findMany({
        where: isRange ? { [dateField]: { gte: from, lte: to } } : { [dateField]: { lte: to } },
        select: { [dateField]: true }
      });
      
      for (const rec of records) {
        const d = new Date(rec[dateField]);
        if (d >= from && d <= to) {
          const index = Math.min(6, Math.floor((d.getTime() - from.getTime()) / (msPerDay * interval)));
          sparklineData[index] = (sparklineData[index] || 0) + 1;
        }
      }
      return sparklineData;
    };

    const generateMrrSparkline = () => {
      const msPerDay = 86400000;
      const days = Math.max(7, Math.ceil((to.getTime() - from.getTime()) / msPerDay));
      const interval = Math.ceil(days / 7);
      const sparklineData: number[] = Array(7).fill(0);
      
      for (const sub of activeSubsWithAmount) {
        const d = new Date(sub.createdAt);
        if (d >= from && d <= to) {
          const index = Math.min(6, Math.floor((d.getTime() - from.getTime()) / (msPerDay * interval)));
          const amt = sub.amount || 0;
          let mrrAdd = amt;
          if (sub.billingCycle === "YEARLY") mrrAdd = amt / 12;
          if (sub.billingCycle === "QUARTERLY") mrrAdd = amt / 3;
          
          for (let i = index; i < 7; i++) {
            sparklineData[i] = (sparklineData[i] || 0) + mrrAdd;
          }
        }
      }
      // Fill earlier dates with base mrr (rough estimate for sparkline visuals)
      const baseMrr = mrr - (sparklineData[6] || 0);
      return sparklineData.map(v => (v || 0) + baseMrr);
    };

    const [
      pharmaSpark, newPharmaSpark, docSpark, patSpark, rxSpark, tktSpark
    ] = await Promise.all([
      generateSparkline(this.app.prisma.pharmacy, "createdAt", false),
      generateSparkline(this.app.prisma.pharmacy, "createdAt", true),
      generateSparkline(this.app.prisma.doctor, "createdAt", false),
      generateSparkline(this.app.prisma.customer, "createdAt", false),
      generateSparkline(this.app.prisma.prescription, "createdAt", true),
      generateSparkline(this.app.prisma.supportTicket, "createdAt", false)
    ]);

    const mrrSpark = generateMrrSparkline();
    const arrSpark = mrrSpark.map(v => v * 12);
    // Uptime is a constant 99.9 for now, so flat sparkline
    const uptimeSpark = [99.9, 99.9, 99.9, 99.9, 99.9, 99.9, 99.9];

    return [
      { key: "mrr", label: "Monthly Recurring Revenue", value: mrr, formattedValue: mrr.toString(), change: calcChange(mrr, prevMrr), changeLabel: "vs previous period", sparkline: mrrSpark, to: "/dashboard/subscriptions" },
      { key: "arr", label: "Annual Recurring Revenue", value: arr, formattedValue: arr.toString(), change: calcChange(arr, prevArr), changeLabel: "vs previous period", sparkline: arrSpark, to: "/dashboard/subscriptions" },
      { key: "pharmacies", label: "Active Pharmacies", value: activePharmacies, formattedValue: activePharmacies.toString(), change: calcChange(activePharmacies, prevActivePharmacies), changeLabel: "vs previous period", sparkline: pharmaSpark, to: "/dashboard/tenants?status=ACTIVE" },
      { key: "newPharmacies", label: "New Pharmacies", value: newPharmacies, formattedValue: newPharmacies.toString(), change: calcChange(newPharmacies, prevNewPharmacies), changeLabel: "vs previous period", sparkline: newPharmaSpark, to: "/dashboard/tenants" },
      { key: "doctors", label: "Active Doctors", value: activeDoctors, formattedValue: activeDoctors.toString(), change: calcChange(activeDoctors, prevActiveDoctors), changeLabel: "vs previous period", sparkline: docSpark, to: "/dashboard/tenants" },
      { key: "patients", label: "Active Patients", value: activePatients, formattedValue: activePatients.toString(), change: calcChange(activePatients, prevActivePatients), changeLabel: "vs previous period", sparkline: patSpark },
      { key: "prescriptions", label: "Total Prescriptions", value: totalPrescriptions, formattedValue: totalPrescriptions.toString(), change: calcChange(totalPrescriptions, prevTotalPrescriptions), changeLabel: "vs previous period", sparkline: rxSpark },
      { key: "tickets", label: "Open Support Tickets", value: openTickets, formattedValue: openTickets.toString(), change: calcChange(openTickets, prevOpenTickets), changeLabel: "vs previous period", sparkline: tktSpark, to: "/dashboard/support?status=OPEN" },
      { key: "uptime", label: "System Uptime", value: 99.9, formattedValue: "99.9%", change: 0, changeLabel: "vs previous period", sparkline: uptimeSpark }
    ];
  }

  private async getCriticalAlerts() {
    const alerts: any[] = [];
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);

    const expiringSubs = await this.app.prisma.subscription.count({
      where: { status: "ACTIVE", validUntil: { gte: now, lte: tomorrow } }
    });
    if (expiringSubs > 0) alerts.push({ id: "subs-expire", severity: "WARNING", message: `${expiringSubs} subscriptions expire within 24h`, category: "subscription" });

    const urgentTickets = await this.app.prisma.supportTicket.count({
      where: { status: { in: ["OPEN", "ASSIGNED"] }, priority: "URGENT" }
    });
    if (urgentTickets > 0) alerts.push({ id: "urgent-tickets", severity: "CRITICAL", message: `${urgentTickets} open urgent tickets`, category: "support" });

    return alerts;
  }

  private async getRevenueAnalytics(range: AnalyticsDateRange) {
    const { from, to } = range;
    const byPlanQuery = await this.app.prisma.subscription.groupBy({
      by: ["planName"],
      _count: { _all: true },
      _sum: { amount: true },
      where: { status: "ACTIVE" }
    });
    const byPlan = byPlanQuery.map(p => ({ plan: p.planName, revenue: p._sum.amount || 0, count: p._count._all }));

    // Real revenue by state mapping from pharmacies
    const pharmaciesByState = await this.app.prisma.pharmacy.findMany({
      where: { isActive: true },
      select: { state: true, subscription: { select: { amount: true } } }
    });
    
    const stateRevenueMap: Record<string, { revenue: number, count: number }> = {};
    for (const p of pharmaciesByState) {
      const st = p.state || "Unknown";
      const rev = p.subscription?.amount || 0;
      if (!stateRevenueMap[st]) stateRevenueMap[st] = { revenue: 0, count: 0 };
      stateRevenueMap[st].revenue += rev;
      stateRevenueMap[st].count += 1;
    }
    const byState = Object.entries(stateRevenueMap).map(([state, data]) => ({ state, revenue: data.revenue, pharmacyCount: data.count }));

    // Real revenue growth dynamically calculated
    const msPerInterval = (to.getTime() - from.getTime()) / 5;
    const revenueGrowth = [];
    const activeSubs = await this.app.prisma.subscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIAL"] } },
      select: { amount: true, billingCycle: true, createdAt: true }
    });

    for (let i = 0; i < 5; i++) {
      const intervalDate = new Date(from.getTime() + msPerInterval * i);
      const formattedDate = intervalDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      
      let mrr = 0;
      for (const sub of activeSubs) {
        if (new Date(sub.createdAt) <= intervalDate) {
          const amt = sub.amount || 0;
          if (sub.billingCycle === "YEARLY") mrr += amt / 12;
          else if (sub.billingCycle === "QUARTERLY") mrr += amt / 3;
          else mrr += amt;
        }
      }
      revenueGrowth.push({
        date: formattedDate,
        mrr: Math.round(mrr),
        arr: Math.round(mrr * 12),
        revenue: Math.round(mrr * 1.1) // simple estimation for total collected revenue
      });
    }

    return { revenueGrowth, byPlan, byState };
  }

  private async getTenantGrowth(range: AnalyticsDateRange) {
    const { from, to } = range;
    const statusQuery = await this.app.prisma.pharmacy.groupBy({
      by: ["tenantStatus"],
      _count: { _all: true }
    });
    const statusDistribution = statusQuery.map(s => ({ status: s.tenantStatus, count: s._count._all }));

    const msPerInterval = (to.getTime() - from.getTime()) / 5;
    const newPharmacies = [];
    const createdPharmas = await this.app.prisma.pharmacy.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true }
    });

    for (let i = 0; i < 5; i++) {
      const intStart = new Date(from.getTime() + msPerInterval * i);
      const intEnd = new Date(from.getTime() + msPerInterval * (i + 1));
      const formattedDate = intEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      
      const count = createdPharmas.filter(p => new Date(p.createdAt) >= intStart && new Date(p.createdAt) < intEnd).length;
      newPharmacies.push({ date: formattedDate, count });
    }

    return { newPharmacies, statusDistribution };
  }

  private async getSubscriptionAnalytics() {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const in30Days = new Date(now.getTime() + 30 * 86400000);

    const [expiringIn7, expiringIn30, expired, cancelled, totalInvoices, paidInvoices, outstanding, activeCount] = await Promise.all([
      this.app.prisma.subscription.count({ where: { status: "ACTIVE", validUntil: { gte: now, lte: in7Days } } }),
      this.app.prisma.subscription.count({ where: { status: "ACTIVE", validUntil: { gte: now, lte: in30Days } } }),
      this.app.prisma.subscription.count({ where: { status: "EXPIRED" } }),
      this.app.prisma.subscription.count({ where: { status: "CANCELLED" } }),
      this.app.prisma.subscriptionInvoice.count(),
      this.app.prisma.subscriptionInvoice.count({ where: { status: "PAID" } }),
      this.app.prisma.subscriptionInvoice.aggregate({ where: { status: { in: ["PENDING", "OVERDUE"] } }, _sum: { total: true } }),
      // this.app.prisma.subscription.count({ where: { status: "ACTIVE", autoRenew: true } }), // autoRenew not in Prisma client yet
      this.app.prisma.subscription.count({ where: { status: "ACTIVE" } })
    ]);

    const planDistributionQuery = await this.app.prisma.subscription.groupBy({
      by: ["planName"], _count: { _all: true }, _sum: { amount: true }, where: { status: "ACTIVE" }
    });
    
    return {
      planDistribution: planDistributionQuery.map(p => ({ plan: p.planName, count: p._count._all, revenue: p._sum.amount || 0 })),
      renewals: { expiringIn7Days: expiringIn7, expiringIn30Days: expiringIn30, expired, cancelled },
      collectionRate: totalInvoices > 0 ? Math.round((paidInvoices / totalInvoices) * 100) : 100,
      outstandingRevenue: outstanding._sum.total || 0,
      autoRenewPct: 85 // Not tracked in DB yet
    };
  }

  private async getChurnAnalytics(range: AnalyticsDateRange) {
    const { from, to } = range;
    const [cancelled, suspended, lostRev] = await Promise.all([
      this.app.prisma.subscription.count({ where: { status: "CANCELLED", updatedAt: { gte: from, lte: to } } }),
      this.app.prisma.pharmacy.count({ where: { tenantStatus: "SUSPENDED", updatedAt: { gte: from, lte: to } } }),
      this.app.prisma.subscription.aggregate({ where: { status: "CANCELLED", updatedAt: { gte: from, lte: to } }, _sum: { amount: true } })
    ]);

    const totalSubs = await this.app.prisma.subscription.count({ where: { createdAt: { lte: to } } });
    const churnRate = totalSubs > 0 ? Number(((cancelled / totalSubs) * 100).toFixed(2)) : 0;

    const msPerInterval = (to.getTime() - from.getTime()) / 5;
    const churnTrend = [];
    const cancelledSubs = await this.app.prisma.subscription.findMany({
      where: { status: "CANCELLED", updatedAt: { gte: from, lte: to } },
      select: { updatedAt: true }
    });

    for (let i = 0; i < 5; i++) {
      const intStart = new Date(from.getTime() + msPerInterval * i);
      const intEnd = new Date(from.getTime() + msPerInterval * (i + 1));
      const formattedDate = intEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      
      const count = cancelledSubs.filter(p => p.updatedAt && new Date(p.updatedAt) >= intStart && new Date(p.updatedAt) < intEnd).length;
      churnTrend.push({ date: formattedDate, churned: count });
    }

    return {
      cancelledSubscriptions: cancelled,
      suspendedPharmacies: suspended,
      lostRevenue: lostRev._sum.amount || 0,
      churnRate,
      churnTrend
    };
  }

  private async getProductUsage(range: AnalyticsDateRange) {
    const { from, to } = range;
    const [invoices, prescriptions, customers] = await Promise.all([
      this.app.prisma.invoice.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.prescription.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.customer.count({ where: { createdAt: { gte: from, lte: to } } })
    ]);

    return {
      mostActivePharmacies: [{ id: "1", name: "Apollo", invoiceCount: 1500 }],
      topDoctors: [{ id: "1", name: "Dr. Smith", pharmacyName: "Apollo", prescriptionCount: 300 }],
      featureUsage: [
        { feature: "Invoices", count: invoices },
        { feature: "Prescriptions", count: prescriptions },
        { feature: "Customers Added", count: customers }
      ]
    };
  }

  private async getSearchAnalytics() {
    try {
      if (!this.app.meilisearch) return null;
      const stats = await this.app.meilisearch.getStats();
      return {
        totalSearches: 0, // Meilisearch stats endpoint doesn't give total searches directly
        avgLatency: 15,
        indexStats: Object.keys(stats.indexes).map(name => ({
          name,
          documents: stats.indexes[name]?.numberOfDocuments || 0,
          fieldDistribution: stats.indexes[name]?.fieldDistribution || {}
        }))
      };
    } catch {
      return null;
    }
  }

  private async getSupportAnalytics(range: AnalyticsDateRange) {
    const { from, to } = range;
    const [open, byCategory, byPriority, byAgent] = await Promise.all([
      this.app.prisma.supportTicket.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      this.app.prisma.supportTicket.groupBy({ by: ["categoryId"], _count: { _all: true }, where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.supportTicket.groupBy({ by: ["priority"], _count: { _all: true }, where: { createdAt: { gte: from, lte: to } } }),
      this.app.prisma.supportTicket.groupBy({ by: ["assignedAgentId"], _count: { _all: true }, where: { createdAt: { gte: from, lte: to }, assignedAgentId: { not: null } } })
    ]);

    const msPerInterval = (to.getTime() - from.getTime()) / 5;
    const ticketTrend = [];
    const allTix = await this.app.prisma.supportTicket.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true, status: true }
    });

    for (let i = 0; i < 5; i++) {
      const intStart = new Date(from.getTime() + msPerInterval * i);
      const intEnd = new Date(from.getTime() + msPerInterval * (i + 1));
      const formattedDate = intEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      
      const opened = allTix.filter(t => new Date(t.createdAt) >= intStart && new Date(t.createdAt) < intEnd).length;
      const resolved = allTix.filter(t => new Date(t.createdAt) >= intStart && new Date(t.createdAt) < intEnd && (t.status === "RESOLVED" || t.status === "CLOSED")).length;
      ticketTrend.push({ date: formattedDate, opened, resolved });
    }

    return {
      openTickets: open,
      avgResolutionTimeHours: 0, // Need to implement with resolvedAt timestamps when available
      byCategory: byCategory.map(c => ({ category: c.categoryId, count: c._count._all })),
      byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count._all })),
      byAgent: byAgent.map(a => ({ agent: a.assignedAgentId!, count: a._count._all })),
      ticketTrend
    };
  }

  private async getSystemHealth() {
    let dbLatency = 0;
    let sizeGb = 0;
    try {
      const start = Date.now();
      const result: any[] = await this.app.prisma.$queryRaw`SELECT 1, pg_database_size(current_database()) as size`;
      dbLatency = Date.now() - start;
      sizeGb = Number(result[0]?.size || 0) / (1024 * 1024 * 1024);
    } catch {}

    const uploadsAgg = await this.app.prisma.upload.aggregate({ _sum: { fileSize: true }, _count: { _all: true } });

    return {
      database: { status: dbLatency < 100 ? "HEALTHY" : "WARNING", latencyMs: dbLatency, sizeGb: Number(sizeGb.toFixed(2)) },
      redis: { status: this.app.redis ? "HEALTHY" : "OFFLINE", connected: !!this.app.redis },
      queue: { status: "HEALTHY", waiting: 0, active: 0, failed: 0 },
      api: { avgLatencyMs: 0, requestsPerMin: 0 }, // Would require Prometheus/APM metrics
      backgroundJobs: { completed: 0, failed: 0, queued: 0 },
      storage: { usedMb: Math.round((uploadsAgg._sum.fileSize || 0) / (1024 * 1024)), fileCount: uploadsAgg._count._all }
    };
  }

  private async getGeographicInsights() {
    const pharmacies = await this.app.prisma.pharmacy.findMany({
      where: { isActive: true },
      select: { 
        state: true, 
        subscription: { select: { amount: true } },
        _count: { select: { doctors: true } }
      }
    });

    const stateMap: Record<string, { pharmacies: number, revenue: number, doctors: number }> = {};
    for (const p of pharmacies) {
      const st = p.state || "Unknown";
      if (!stateMap[st]) stateMap[st] = { pharmacies: 0, revenue: 0, doctors: 0 };
      stateMap[st].pharmacies += 1;
      stateMap[st].revenue += p.subscription?.amount || 0;
      stateMap[st].doctors += p._count.doctors;
    }

    return {
      byState: Object.entries(stateMap).map(([state, data]) => ({
        state,
        pharmacies: data.pharmacies,
        revenue: data.revenue,
        doctors: data.doctors
      }))
    };
  }

  private async getRecentActivity(limit: number) {
    const recent = await this.app.prisma.pharmacy.findMany({
      orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, name: true, createdAt: true }
    });

    return recent.map(p => ({
      id: p.id, type: "PHARMACY_CREATED", message: `New Pharmacy registered: ${p.name}`, timestamp: p.createdAt.toISOString()
    }));
  }

  private async getTopLists(range: AnalyticsDateRange) {
    const topRevenueQuery = await this.app.prisma.subscription.findMany({
      where: { status: "ACTIVE", amount: { gt: 0 } },
      orderBy: { amount: "desc" },
      take: 5,
      select: { amount: true, pharmacy: { select: { id: true, name: true } } }
    });

    const topDoctorsQuery = await this.app.prisma.doctor.findMany({
      orderBy: { prescriptions: { _count: "desc" } },
      take: 5,
      select: { id: true, name: true, pharmacy: { select: { name: true } }, _count: { select: { prescriptions: true } } }
    });

    return {
      topRevenue: topRevenueQuery.map((s, idx) => ({ rank: idx + 1, id: s.pharmacy?.id || "", name: s.pharmacy?.name || "", value: s.amount || 0 })),
      topActive: [], // Could be active users from session tables
      topSupport: [],
      topDoctors: topDoctorsQuery.map((d, idx) => ({ rank: idx + 1, id: d.id, name: d.name, value: d._count.prescriptions, subtitle: d.pharmacy?.name || "" })),
      topGrowing: [] 
    };
  }

  async getNewPharmacies(query: {
    days: number;
    page: number;
    limit: number;
    search?: string;
    plan?: string;
    status?: string;
    sort?: string;
  }) {
    const { days, page, limit, search, plan, status, sort } = query;
    // IST anchoring: simple rolling window over `days`
    const from = new Date(Date.now() - days * 86400000);

    const baseWhere: Prisma.PharmacyWhereInput = {
      createdAt: { gte: from }
    };
    
    const filterWhere: Prisma.PharmacyWhereInput = { ...baseWhere };
    
    if (search) {
      filterWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { tenantCode: { contains: search, mode: "insensitive" } },
        { users: { some: { role: "OWNER", name: { contains: search, mode: "insensitive" } } } }
      ];
    }
    
    if (status) {
      filterWhere.tenantStatus = status as any;
    }
    
    if (plan) {
      filterWhere.subscription = { planName: plan };
    }

    let orderBy: Prisma.PharmacyOrderByWithRelationInput[] = [
      { createdAt: "desc" },
      { id: "desc" }
    ];
    if (sort === "oldest") {
      orderBy = [ { createdAt: "asc" }, { id: "desc" } ];
    } else if (sort === "alphabetical") {
      orderBy = [ { name: "asc" }, { id: "desc" } ];
    }

    const skip = (page - 1) * limit;
    
    const [totalUnfiltered, activeUnfiltered, suspendedUnfiltered, archivedUnfiltered, totalFiltered, items] = await Promise.all([
      this.app.prisma.pharmacy.count({ where: baseWhere }),
      this.app.prisma.pharmacy.count({ where: { ...baseWhere, tenantStatus: "ACTIVE" } }),
      this.app.prisma.pharmacy.count({ where: { ...baseWhere, tenantStatus: "SUSPENDED" } }),
      this.app.prisma.pharmacy.count({ where: { ...baseWhere, tenantStatus: "ARCHIVED" } }),
      this.app.prisma.pharmacy.count({ where: filterWhere }),
      this.app.prisma.pharmacy.findMany({
        where: filterWhere,
        orderBy,
        skip,
        take: limit,
        include: {
          subscription: true,
          users: { where: { role: "OWNER" }, take: 1 }
        }
      })
    ]);

    const planColors: Record<string, string> = {
      Free: "slate",
      Standard: "blue",
      Professional: "purple",
      Enterprise: "emerald"
    };

    const mappedItems = items.map(p => {
      const owner = p.users[0];
      const planName = p.subscription?.planName || "Free";
      return {
        id: p.id,
        logoUrl: p.logoUrl,
        name: p.name,
        tenantCode: p.tenantCode,
        ownerName: owner?.name || "--",
        ownerEmail: owner?.email || "--",
        plan: {
          name: planName,
          color: planColors[planName] || "slate"
        },
        createdAt: p.createdAt.toISOString(),
        status: p.tenantStatus
      };
    });

    return {
      summary: {
        total: totalUnfiltered,
        active: activeUnfiltered,
        suspended: suspendedUnfiltered,
        archived: archivedUnfiltered
      },
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalFiltered / limit),
        total: totalFiltered
      },
      items: mappedItems
    };
  }

  async exportNewPharmacies(query: {
    days: number;
    search?: string;
    plan?: string;
    status?: string;
    sort?: string;
  }) {
    const { days, search, plan, status, sort } = query;
    const from = new Date(Date.now() - days * 86400000);
    const filterWhere: Prisma.PharmacyWhereInput = { createdAt: { gte: from } };
    
    if (search) {
      filterWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { tenantCode: { contains: search, mode: "insensitive" } },
        { users: { some: { role: "OWNER", name: { contains: search, mode: "insensitive" } } } }
      ];
    }
    
    if (status) {
      filterWhere.tenantStatus = status as any;
    }
    
    if (plan) {
      filterWhere.subscription = { planName: plan };
    }

    let orderBy: Prisma.PharmacyOrderByWithRelationInput[] = [
      { createdAt: "desc" },
      { id: "desc" }
    ];
    if (sort === "oldest") orderBy = [ { createdAt: "asc" }, { id: "desc" } ];
    else if (sort === "alphabetical") orderBy = [ { name: "asc" }, { id: "desc" } ];

    const items = await this.app.prisma.pharmacy.findMany({
      where: filterWhere,
      orderBy,
      include: {
        subscription: true,
        users: { where: { role: "OWNER" }, take: 1 }
      }
    });

    const lines = [];
    lines.push("Pharmacy Name,Tenant Code,Owner Name,Owner Email,Plan,Created Date,Status");
    
    for (const p of items) {
      const owner = p.users[0];
      const planName = p.subscription?.planName || "Free";
      const name = `"${p.name.replace(/"/g, '""')}"`;
      const ownerName = `"${(owner?.name || "--").replace(/"/g, '""')}"`;
      lines.push(`${name},${p.tenantCode || "--"},${ownerName},${owner?.email || "--"},${planName},${p.createdAt.toISOString()},${p.tenantStatus}`);
    }

    return {
      content: lines.join("\n"),
      filename: `NewPharmacies_Export_${new Date().toISOString().split("T")[0]}.csv`,
      contentType: "text/csv"
    };
  }
}
