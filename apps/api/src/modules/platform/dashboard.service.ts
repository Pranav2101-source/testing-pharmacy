import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/AppError.js";

export class DashboardService {
  constructor(private app: FastifyInstance) {}

  async getPlatformDashboardStats() {
    const prisma = this.app.prisma;
    
    // Real Data (Prisma Aggregations)
    const [
      totalPharmacies,
      activePharmacies,
      totalDoctors,
      totalPatients,
      totalUsers,
      totalTickets,
      openTickets,
      urgentTickets,
      totalConsultations
    ] = await Promise.all([
      prisma.pharmacy.count(),
      prisma.pharmacy.count({ where: { isActive: true } }),
      prisma.doctor.count(),
      prisma.customer.count(),
      prisma.user.count(),
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_USER"] } } }),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "ASSIGNED"] }, priority: "URGENT" } }),
      prisma.prescription.count() // Assuming prescriptions map to consultations roughly
    ]);

    // Constructing recent live platform activity feed (last 10 combined)
    // - Latest pharmacies
    // - Latest tickets
    // - Latest payments (Mock for now since we don't have subscription payments in DB, we'll mock them later or leave empty in real)
    
    const recentPharmacies = await prisma.pharmacy.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, name: true, createdAt: true }
    });
    
    const recentTickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, ticketNumber: true, createdAt: true }
    });
    
    const activityFeed = [
      ...recentPharmacies.map(p => ({
        id: p.id,
        type: "PHARMACY_CREATED",
        message: `New Pharmacy registered: ${p.name}`,
        timestamp: p.createdAt
      })),
      ...recentTickets.map(t => ({
        id: t.id,
        type: "TICKET_CREATED",
        message: `New Support Ticket raised: ${t.ticketNumber}`,
        timestamp: t.createdAt
      }))
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // System Health (Live Checks)
    let dbStatus = "WARNING", dbValue = "Timeout", dbDetail = "Could not connect";
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      dbStatus = "HEALTHY";
      dbValue = `${latency}ms`;
      dbDetail = "PostgreSQL active";
    } catch (e) { }

    let redisStatus = "WARNING", redisValue = "Disconnected", redisDetail = "No connection";
    const redis = this.app.redis;
    if (redis) {
      try {
        await redis.ping();
        redisStatus = "HEALTHY";
        redisValue = "Connected";
        redisDetail = "Active";
      } catch (e) { }
    } else {
      redisStatus = "OFFLINE";
      redisDetail = "Not configured";
    }

    let storageStatus = "WARNING", storageValue = "Unknown", storageDetail = "Unable to read size";
    try {
      // Query PostgreSQL for current database size
      const result: any[] = await prisma.$queryRaw`SELECT pg_database_size(current_database()) as size`;
      const sizeBytes = result[0]?.size || 0;
      const sizeMB = (Number(sizeBytes) / 1024 / 1024).toFixed(2);
      storageStatus = "HEALTHY";
      storageValue = `${sizeMB} MB`;
      storageDetail = "PostgreSQL DB Size";
    } catch (e) { }

    // Query Boss for queue status (if boss table exists, otherwise just omit queue or keep basic check)
    let queueStatus = "OFFLINE", queueValue = "--", queueDetail = "Not tracked";

    const systemHealth = {
      database: { status: dbStatus, value: dbValue, detail: dbDetail },
      redis: { status: redisStatus, value: redisValue, detail: redisDetail },
      queue: { status: queueStatus, value: queueValue, detail: queueDetail },
      storage: { status: storageStatus, value: storageValue, detail: storageDetail },
      api: { status: "HEALTHY", value: "Online", detail: "Serving requests" }
    };

    // Financial Metrics (MRR / ARR)
    // Cache Key: platform:dashboard:financials
    let financials = { mrr: 0, arr: 0, todaysRevenue: 0, renewalsToday: 0, failedPayments: 0, outstandingInvoices: 0 };
    let cachedFinancials: string | null = null;
    if (redis) {
      cachedFinancials = await redis.get("platform:dashboard:financials");
    }

    if (cachedFinancials) {
      try {
        financials = JSON.parse(cachedFinancials);
      } catch {
        cachedFinancials = null;
      }
    }
    if (!cachedFinancials) {
      // Filter: active subscriptions
      const activeSubs = await prisma.subscription.findMany({
        where: { status: "ACTIVE" },
        select: { amount: true, billingCycle: true }
      });

      let mrr = 0;
      for (const sub of activeSubs) {
        const amt = sub.amount || 0;
        if (sub.billingCycle === "MONTHLY") mrr += amt;
        else if (sub.billingCycle === "QUARTERLY") mrr += amt / 3;
        else if (sub.billingCycle === "YEARLY") mrr += amt / 12;
      }
      
      const arr = mrr * 12;
      
      // We don't have tables for payments or invoices yet, so they remain 0
      financials = {
        mrr: Math.round(mrr),
        arr: Math.round(arr),
        todaysRevenue: 0,
        renewalsToday: 0,
        failedPayments: 0,
        outstandingInvoices: 0
      };

      if (redis) {
        await redis.setex("platform:dashboard:financials", 60, JSON.stringify(financials));
      }
    }
    
    // Critical Alerts
    const criticalAlerts = [];
    if (urgentTickets > 0) {
      criticalAlerts.push({ id: "alert-2", type: "DANGER", message: `⚠ ${urgentTickets} open urgent tickets` });
    }

    return {
      real: {
        totalPharmacies,
        activePharmacies,
        totalDoctors,
        totalPatients,
        totalUsers,
        totalTickets,
        openTickets,
        urgentTickets,
        totalConsultations,
        activityFeed
      },
      // Note: `mock` property is removed, sending these under a `metrics` and `systemHealth` object instead.
      metrics: financials,
      systemHealth,
      criticalAlerts
    };
  }

  async exportDashboardReport(): Promise<string> {
    const stats = await this.getPlatformDashboardStats();

    // Required columns:
    // Monthly Recurring Revenue, Annual Recurring Revenue, Active Pharmacies, Active Doctors,
    // Active Patients, Active Subscriptions, Revenue Summary, Storage Usage, Support Ticket Summary

    const mrr = stats.metrics.mrr;
    const arr = stats.metrics.arr;
    const activePharmacies = stats.real.activePharmacies;
    const activeDoctors = stats.real.totalDoctors;
    const activePatients = stats.real.totalPatients;
    
    // We can count active subscriptions directly since it's an easy aggregation
    const activeSubscriptions = await this.app.prisma.subscription.count({ where: { status: "ACTIVE" } });

    const todaysRevenue = stats.metrics.todaysRevenue;
    const storageUsage = stats.systemHealth.storage.value;
    const supportTickets = `${stats.real.openTickets} Open / ${stats.real.urgentTickets} Urgent`;

    const headers = [
      "Metric",
      "Value"
    ].join(",");

    const rows = [
      ["Monthly Recurring Revenue (MRR)", mrr],
      ["Annual Recurring Revenue (ARR)", arr],
      ["Today's Revenue", todaysRevenue],
      ["Active Subscriptions", activeSubscriptions],
      ["Active Pharmacies", activePharmacies],
      ["Active Doctors", activeDoctors],
      ["Active Patients", activePatients],
      ["Storage Usage", storageUsage],
      ["Support Tickets", supportTickets]
    ];

    const csvRows = rows.map(r => r.join(","));
    
    return [headers, ...csvRows].join("\n");
  }
}
