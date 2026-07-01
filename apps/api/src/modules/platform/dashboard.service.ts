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

    // --- MOCK DATA ---
    // For elements requested that don't exist in Prisma schema yet.
    
    // Revenue
    const mrr = 845000;
    const arr = 10140000;
    const todaysRevenue = 14999;
    const renewalsToday = 24;
    const failedPayments = 3;
    const outstandingInvoices = 8;
    
    // System Health
    const systemHealth = {
      database: { status: "HEALTHY", value: "98.7%", detail: "3 ms latency" },
      redis: { status: "HEALTHY", value: "Connected", detail: "Active" },
      queue: { status: "WARNING", value: "12 waiting", detail: "Processing delayed" },
      storage: { status: "HEALTHY", value: "67%", detail: "2.1 TB used" },
      api: { status: "HEALTHY", value: "428 req/min", detail: "Avg 45ms" }
    };
    
    // Critical Alerts
    const criticalAlerts = [];
    if (failedPayments > 0) {
      criticalAlerts.push({ id: "alert-1", type: "WARNING", message: `⚠ ${failedPayments} Failed payments today` });
    }
    if (urgentTickets > 0) {
      criticalAlerts.push({ id: "alert-2", type: "DANGER", message: `⚠ ${urgentTickets} open urgent tickets` });
    }
    criticalAlerts.push({ id: "alert-3", type: "WARNING", message: "⚠ Subscription expires tomorrow" });
    criticalAlerts.push({ id: "alert-4", type: "DANGER", message: "⚠ Storage 95%" }); // Mock alert as requested by user example

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
      mock: {
        revenue: { mrr, arr, todaysRevenue, renewalsToday, failedPayments, outstandingInvoices },
        systemHealth,
        criticalAlerts
      }
    };
  }
}
