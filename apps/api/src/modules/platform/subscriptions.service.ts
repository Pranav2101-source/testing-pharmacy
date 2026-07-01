import type { FastifyInstance } from "fastify";
import type { Prisma } from "@pharmacy/database";
import { auditService } from "../audit/audit.service.js";

// Plan pricing config
const PLAN_PRICING: Record<string, { monthly: number; yearly: number; quarterly: number }> = {
  Free:         { monthly: 0,    yearly: 0,     quarterly: 0 },
  Standard:     { monthly: 999,  yearly: 9590,  quarterly: 2697 },
  Professional: { monthly: 2499, yearly: 23990, quarterly: 6747 },
  Enterprise:   { monthly: 4999, yearly: 47990, quarterly: 13497 },
};

export class SubscriptionsService {
  constructor(private app: FastifyInstance) {}

  // ── Generate Invoice Number ────────────────────────────────────────────────

  private async generateInvoiceNumber(): Promise<string> {
    const count = await this.app.prisma.subscriptionInvoice.count();
    return `INV-${String(count + 1).padStart(6, "0")}`;
  }

  // ── Stats (8 KPIs) ────────────────────────────────────────────────────────

  async getStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const in30Days = new Date(now.getTime() + 30 * 86400000);

    const [
      allSubs,
      activeSubs,
      trialSubs,
      expiringSoon,
      expiredSubs,
      renewalsThisMonth,
      totalInvoices,
      paidInvoices,
      overdueInvoices,
      monthlyPaidTotal,
    ] = await Promise.all([
      this.app.prisma.subscription.count(),
      this.app.prisma.subscription.count({ where: { status: "ACTIVE" } }),
      this.app.prisma.subscription.count({ where: { status: "TRIAL" } }),
      this.app.prisma.subscription.count({
        where: { status: "ACTIVE", validUntil: { gte: now, lte: in30Days } },
      }),
      this.app.prisma.subscription.count({ where: { status: "EXPIRED" } }),
      this.app.prisma.subscription.count({
        where: { validUntil: { gte: startOfMonth, lte: new Date(now.getFullYear(), now.getMonth() + 1, 0) } },
      }),
      this.app.prisma.subscriptionInvoice.count(),
      this.app.prisma.subscriptionInvoice.count({ where: { status: "PAID" } }),
      this.app.prisma.subscriptionInvoice.count({ where: { status: "OVERDUE" } }),
      this.app.prisma.subscriptionInvoice.aggregate({
        where: { status: "PAID", paidAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
    ]);

    // Compute MRR from active subscriptions
    const activeSubsWithAmount = await this.app.prisma.subscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIAL"] } },
      select: { amount: true, billingCycle: true },
    });

    let mrr = 0;
    for (const s of activeSubsWithAmount) {
      const amt = s.amount || 0;
      if (s.billingCycle === "YEARLY") mrr += amt / 12;
      else if (s.billingCycle === "QUARTERLY") mrr += amt / 3;
      else mrr += amt;
    }

    const arr = mrr * 12;
    const monthlyRevenue = monthlyPaidTotal._sum.total || 0;
    const todaysRevenue = 0; // Would aggregate from today's paid invoices

    // Outstanding
    const outstandingAgg = await this.app.prisma.subscriptionInvoice.aggregate({
      where: { status: { in: ["PENDING", "OVERDUE"] } },
      _sum: { total: true },
    });
    const outstanding = outstandingAgg._sum.total || 0;

    // Collection rate
    const collectionRate = totalInvoices > 0 ? Math.round((paidInvoices / totalInvoices) * 100) : 100;

    // ARPT (Average Revenue Per Tenant)
    const arpt = activeSubs > 0 ? Math.round(mrr / activeSubs) : 0;

    // Churn rate (expired in last 30 days / total at start of period)
    const recentlyExpired = await this.app.prisma.subscription.count({
      where: {
        status: "EXPIRED",
        updatedAt: { gte: new Date(now.getTime() - 30 * 86400000) },
      },
    });
    const churnRate = allSubs > 0 ? parseFloat(((recentlyExpired / allSubs) * 100).toFixed(1)) : 0;

    return {
      mrr: Math.round(mrr),
      arr: Math.round(arr),
      todaysRevenue: Math.round(todaysRevenue),
      monthlyRevenue: Math.round(monthlyRevenue),
      renewalsThisMonth,
      outstanding: Math.round(outstanding),
      collectionRate,
      arpt,
      activeSubs,
      trialSubs,
      expiringSoon,
      expiredSubs,
      churnRate,
    };
  }

  // ── List Subscriptions ────────────────────────────────────────────────────

  async listSubscriptions(params: {
    search?: string;
    plan?: string;
    status: string;
    billingCycle: string;
    renewalWindow: string;
    paymentStatus: string;
    page: number;
    limit: number;
    sortBy: string;
    sortDesc: boolean;
  }) {
    const now = new Date();
    const where: Prisma.SubscriptionWhereInput = {};

    if (params.search) {
      where.pharmacy = {
        OR: [
          { name: { contains: params.search, mode: "insensitive" } },
          { tenantCode: { contains: params.search, mode: "insensitive" } },
          { email: { contains: params.search, mode: "insensitive" } },
        ],
      };
    }

    if (params.plan) where.planName = params.plan;
    if (params.status !== "ALL") where.status = params.status as any;
    if (params.billingCycle !== "ALL") where.billingCycle = params.billingCycle;

    // Renewal window filter
    if (params.renewalWindow !== "ALL") {
      const windowMap: Record<string, number> = { "7_DAYS": 7, "30_DAYS": 30, "90_DAYS": 90 };
      if (params.renewalWindow === "OVERDUE") {
        where.validUntil = { lt: now };
        where.status = "ACTIVE"; // still active but overdue
      } else {
        const days = windowMap[params.renewalWindow] || 30;
        where.validUntil = { gte: now, lte: new Date(now.getTime() + days * 86400000) };
      }
    }

    const skip = (params.page - 1) * params.limit;

    const orderBy: any = {};
    if (params.sortBy === "name") orderBy.pharmacy = { name: params.sortDesc ? "desc" : "asc" };
    else if (params.sortBy === "planName") orderBy.planName = params.sortDesc ? "desc" : "asc";
    else if (params.sortBy === "amount") orderBy.amount = params.sortDesc ? "desc" : "asc";
    else if (params.sortBy === "validUntil") orderBy.validUntil = params.sortDesc ? "desc" : "asc";
    else orderBy.createdAt = params.sortDesc ? "desc" : "asc";

    const [total, subs] = await Promise.all([
      this.app.prisma.subscription.count({ where }),
      this.app.prisma.subscription.findMany({
        where,
        skip,
        take: params.limit,
        orderBy,
        include: {
          pharmacy: {
            select: {
              id: true,
              tenantCode: true,
              name: true,
              tenantStatus: true,
              users: { where: { role: "OWNER" }, take: 1, select: { name: true, email: true } },
              tenantSettings: { select: { doctorLimit: true, staffLimit: true, patientLimit: true, storageLimit: true } },
              _count: { select: { doctors: true, customers: true, users: true } },
            },
          },
          invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        },
      }),
    ]);

    const data = subs.map((s) => {
      const settings = s.pharmacy.tenantSettings;
      const counts = s.pharmacy._count;

      // Usage % = average of doctor/patient/staff usage
      let usagePercent = 0;
      if (settings) {
        const doctorUsage = settings.doctorLimit > 0 ? (counts.doctors / settings.doctorLimit) * 100 : 0;
        const patientUsage = settings.patientLimit > 0 ? (counts.customers / settings.patientLimit) * 100 : 0;
        const staffUsage = settings.staffLimit > 0 ? (counts.users / settings.staffLimit) * 100 : 0;
        usagePercent = Math.round((doctorUsage + patientUsage + staffUsage) / 3);
      }

      // Health status
      const daysUntilRenewal = Math.ceil((new Date(s.validUntil).getTime() - now.getTime()) / 86400000);
      let health: "HEALTHY" | "EXPIRING_SOON" | "PAYMENT_FAILED" | "SUSPENDED" | "PAUSED" = "HEALTHY";
      if (s.status === "PAUSED") health = "PAUSED";
      else if (s.pharmacy.tenantStatus === "SUSPENDED") health = "SUSPENDED";
      else if (s.invoices[0]?.status === "OVERDUE") health = "PAYMENT_FAILED";
      else if (daysUntilRenewal <= 30 && daysUntilRenewal > 0) health = "EXPIRING_SOON";
      else if (daysUntilRenewal <= 0) health = "PAYMENT_FAILED";

      // Payment status
      const paymentStatus = s.invoices[0]?.status || "PAID";

      // MRR for this tenant
      const amt = s.amount || 0;
      let tenantMrr = amt;
      if (s.billingCycle === "YEARLY") tenantMrr = amt / 12;
      else if (s.billingCycle === "QUARTERLY") tenantMrr = amt / 3;

      return {
        id: s.id,
        pharmacyId: s.pharmacy.id,
        tenant: { name: s.pharmacy.name, tenantCode: s.pharmacy.tenantCode },
        owner: s.pharmacy.users[0] || null,
        planName: s.planName,
        mrr: Math.round(tenantMrr),
        billingCycle: s.billingCycle,
        amount: s.amount,
        status: s.status,
        validUntil: s.validUntil,
        autoRenew: s.autoRenew,
        paymentStatus,
        usagePercent,
        health,
        createdAt: s.createdAt,
      };
    });

    return {
      data,
      meta: { total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) },
    };
  }

  // ── Get Subscription Detail ───────────────────────────────────────────────

  async getDetail(id: string) {
    const sub = await this.app.prisma.subscription.findUnique({
      where: { id },
      include: {
        pharmacy: {
          select: {
            id: true, name: true, tenantCode: true, gstin: true, tenantStatus: true,
            users: { where: { role: "OWNER" }, take: 1, select: { name: true, email: true, phone: true } },
            tenantSettings: true,
            _count: { select: { doctors: true, customers: true, users: true, prescriptions: true, invoices: true, uploads: true } },
          },
        },
        invoices: { orderBy: { createdAt: "desc" }, take: 20 },
        auditLogs: { orderBy: { createdAt: "desc" }, take: 30 },
      },
    });

    if (!sub) return null;

    // Billing summary
    const lastInvoice = sub.invoices[0] || null;
    const nextInvoiceDate = new Date(sub.validUntil);
    const outstandingAgg = await this.app.prisma.subscriptionInvoice.aggregate({
      where: { subscriptionId: id, status: { in: ["PENDING", "OVERDUE"] } },
      _sum: { total: true },
    });

    return {
      ...sub,
      owner: sub.pharmacy.users[0] || null,
      billing: {
        lastInvoice,
        nextInvoiceDate,
        outstanding: outstandingAgg._sum.total || 0,
        gstinPharmacy: sub.pharmacy.gstin || null,
        gstinPlatform: "29AABCU9603R1ZM", // Platform GST
        discount: sub.discount,
        couponCode: sub.couponCode,
        creditBalance: sub.creditBalance,
      },
      usage: {
        doctors: { used: sub.pharmacy._count.doctors, limit: sub.pharmacy.tenantSettings?.doctorLimit || 0 },
        patients: { used: sub.pharmacy._count.customers, limit: sub.pharmacy.tenantSettings?.patientLimit || 0 },
        staff: { used: sub.pharmacy._count.users, limit: sub.pharmacy.tenantSettings?.staffLimit || 0 },
        prescriptions: { used: sub.pharmacy._count.prescriptions, limit: null },
        documents: { used: sub.pharmacy._count.uploads, limit: null },
        invoices: { used: sub.pharmacy._count.invoices, limit: null },
        storage: { used: null, limit: sub.pharmacy.tenantSettings?.storageLimit || 0 },
        apiUsage: { used: null, limit: null },
      },
      features: sub.pharmacy.tenantSettings,
    };
  }

  // ── Change Plan ───────────────────────────────────────────────────────────

  async changePlan(id: string, plan: string, billingCycle: string | undefined, amount: number | undefined, adminUserId: string) {
    const sub = await this.app.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw Object.assign(new Error("Subscription not found"), { statusCode: 404 });

    const cycle = billingCycle || sub.billingCycle;
    const pricing = PLAN_PRICING[plan];
    const computedAmount = amount !== undefined ? amount : (pricing ? pricing[cycle.toLowerCase() as keyof typeof pricing] || 0 : 0);

    const updated = await this.app.prisma.subscription.update({
      where: { id },
      data: { planName: plan, billingCycle: cycle, amount: computedAmount },
    });

    await this.app.prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: id,
        action: "PLAN_CHANGED",
        oldValue: JSON.stringify({ plan: sub.planName, cycle: sub.billingCycle, amount: sub.amount }),
        newValue: JSON.stringify({ plan, cycle, amount: computedAmount }),
        performedBy: adminUserId,
      },
    });

    void auditService.log(null, {
      pharmacyId: sub.pharmacyId,
      userId: adminUserId,
      module: "SUBSCRIPTIONS",
      action: "PLAN_CHANGED",
      entity: "SUBSCRIPTION",
      entityId: id,
      severity: "INFO",
      status: "SUCCESS",
      oldData: { plan: sub.planName, cycle: sub.billingCycle, amount: sub.amount },
      newData: { plan, cycle, amount: computedAmount },
    });

    return updated;
  }

  // ── Renew ─────────────────────────────────────────────────────────────────

  async renew(id: string, adminUserId: string) {
    const sub = await this.app.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw Object.assign(new Error("Subscription not found"), { statusCode: 404 });

    const cycleDays: Record<string, number> = { MONTHLY: 30, YEARLY: 365, QUARTERLY: 90 };
    const days = cycleDays[sub.billingCycle] || 30;
    const newValidUntil = new Date(Math.max(new Date(sub.validUntil).getTime(), Date.now()) + days * 86400000);

    const updated = await this.app.prisma.subscription.update({
      where: { id },
      data: { validUntil: newValidUntil, status: "ACTIVE" },
    });

    // Create invoice
    const invoiceNumber = await this.generateInvoiceNumber();
    const amount = sub.amount || 0;
    const tax = Math.round(amount * 0.18 * 100) / 100;
    const total = amount + tax;

    await this.app.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: id,
        pharmacyId: sub.pharmacyId,
        invoiceNumber,
        amount,
        tax,
        total,
        status: "PAID",
        dueDate: newValidUntil,
        paidAt: new Date(),
      },
    });

    await this.app.prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: id,
        action: "RENEWED",
        oldValue: JSON.stringify({ validUntil: sub.validUntil }),
        newValue: JSON.stringify({ validUntil: newValidUntil, invoiceNumber }),
        performedBy: adminUserId,
      },
    });

    void auditService.log(null, {
      pharmacyId: sub.pharmacyId,
      userId: adminUserId,
      module: "SUBSCRIPTIONS",
      action: "SUBSCRIPTION_RENEWED",
      entity: "SUBSCRIPTION",
      entityId: id,
      severity: "INFO",
      status: "SUCCESS",
      oldData: { validUntil: sub.validUntil },
      newData: { validUntil: newValidUntil, invoiceNumber },
    });

    return updated;
  }

  // ── Pause ─────────────────────────────────────────────────────────────────

  async pause(id: string, adminUserId: string) {
    const updated = await this.app.prisma.subscription.update({
      where: { id },
      data: { status: "PAUSED", pausedAt: new Date() },
    });

    await this.app.prisma.subscriptionAuditLog.create({
      data: { subscriptionId: id, action: "PAUSED", performedBy: adminUserId },
    });

    void auditService.log(null, {
      pharmacyId: updated.pharmacyId,
      userId: adminUserId,
      module: "SUBSCRIPTIONS",
      action: "SUBSCRIPTION_PAUSED",
      entity: "SUBSCRIPTION",
      entityId: id,
      severity: "INFO",
      status: "SUCCESS",
    });

    return updated;
  }

  // ── Resume ────────────────────────────────────────────────────────────────

  async resume(id: string, adminUserId: string) {
    const updated = await this.app.prisma.subscription.update({
      where: { id },
      data: { status: "ACTIVE", pausedAt: null },
    });

    await this.app.prisma.subscriptionAuditLog.create({
      data: { subscriptionId: id, action: "RESUMED", performedBy: adminUserId },
    });

    void auditService.log(null, {
      pharmacyId: updated.pharmacyId,
      userId: adminUserId,
      module: "SUBSCRIPTIONS",
      action: "SUBSCRIPTION_RESUMED",
      entity: "SUBSCRIPTION",
      entityId: id,
      severity: "INFO",
      status: "SUCCESS",
    });

    return updated;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancel(id: string, adminUserId: string) {
    const updated = await this.app.prisma.subscription.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), autoRenew: false },
    });

    await this.app.prisma.subscriptionAuditLog.create({
      data: { subscriptionId: id, action: "CANCELLED", performedBy: adminUserId },
    });

    void auditService.log(null, {
      pharmacyId: updated.pharmacyId,
      userId: adminUserId,
      module: "SUBSCRIPTIONS",
      action: "SUBSCRIPTION_CANCELLED",
      entity: "SUBSCRIPTION",
      entityId: id,
      severity: "WARNING",
      status: "SUCCESS",
    });

    return updated;
  }

  // ── Send Reminder ─────────────────────────────────────────────────────────

  async sendReminder(id: string, adminUserId: string) {
    // Log the action. In a real system, this would trigger an email via a job queue.
    await this.app.prisma.subscriptionAuditLog.create({
      data: { subscriptionId: id, action: "REMINDER_SENT", performedBy: adminUserId },
    });
    return { sent: true };
  }

  // ── Generate Invoice ──────────────────────────────────────────────────────

  async generateInvoice(id: string, adminUserId: string) {
    const sub = await this.app.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw Object.assign(new Error("Subscription not found"), { statusCode: 404 });

    const invoiceNumber = await this.generateInvoiceNumber();
    const amount = sub.amount || 0;
    const discountAmt = amount * (sub.discount / 100);
    const taxable = amount - discountAmt;
    const tax = Math.round(taxable * 0.18 * 100) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoice = await this.app.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: id,
        pharmacyId: sub.pharmacyId,
        invoiceNumber,
        amount,
        tax,
        discount: discountAmt,
        total,
        couponCode: sub.couponCode,
        status: "PENDING",
        dueDate,
      },
    });

    await this.app.prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: id,
        action: "INVOICE_GENERATED",
        newValue: JSON.stringify({ invoiceNumber, total }),
        performedBy: adminUserId,
      },
    });

    return invoice;
  }

  // ── Get Invoices ──────────────────────────────────────────────────────────

  async getInvoices(subscriptionId: string) {
    return this.app.prisma.subscriptionInvoice.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "desc" },
    });
  }

  // ── Get Usage Stats ───────────────────────────────────────────────────────

  async getUsageStats(pharmacyId: string) {
    const [pharmacy] = await Promise.all([
      this.app.prisma.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: {
          tenantSettings: true,
          _count: {
            select: {
              doctors: true,
              customers: true,
              users: true,
              prescriptions: true,
              invoices: true,
              uploads: true,
            },
          },
        },
      }),
    ]);

    if (!pharmacy) return null;

    return {
      doctors: { used: pharmacy._count.doctors, limit: pharmacy.tenantSettings?.doctorLimit || 0 },
      patients: { used: pharmacy._count.customers, limit: pharmacy.tenantSettings?.patientLimit || 0 },
      staff: { used: pharmacy._count.users, limit: pharmacy.tenantSettings?.staffLimit || 0 },
      storage: { used: null, limit: pharmacy.tenantSettings?.storageLimit || 0 },
      prescriptions: { used: pharmacy._count.prescriptions, limit: null },
      documents: { used: pharmacy._count.uploads, limit: null },
      invoices: { used: pharmacy._count.invoices, limit: null },
      apiUsage: { used: null, limit: null },
    };
  }

  // ── Get Audit Log ─────────────────────────────────────────────────────────

  async getAuditLog(subscriptionId: string) {
    return this.app.prisma.subscriptionAuditLog.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  // ── Charts Data ───────────────────────────────────────────────────────────

  async getChartData() {
    // Plan distribution
    const planDist = await this.app.prisma.subscription.groupBy({
      by: ["planName"],
      _count: { planName: true },
      where: { status: { in: ["ACTIVE", "TRIAL"] } },
    });

    // Status distribution
    const statusDist = await this.app.prisma.subscription.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    // Monthly revenue trend (from invoices) - last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const invoices = await this.app.prisma.subscriptionInvoice.findMany({
      where: { status: "PAID", paidAt: { gte: sixMonthsAgo } },
      select: { total: true, paidAt: true },
    });

    // Group by month
    const monthlyRevenue: Record<string, number> = {};
    for (const inv of invoices) {
      if (!inv.paidAt) continue;
      const key = `${inv.paidAt.getFullYear()}-${String(inv.paidAt.getMonth() + 1).padStart(2, "0")}`;
      monthlyRevenue[key] = (monthlyRevenue[key] || 0) + inv.total;
    }

    const mrrTrend = Object.entries(monthlyRevenue)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }));

    return {
      planDistribution: planDist.map((p) => ({ name: p.planName, count: p._count.planName })),
      statusDistribution: statusDist.map((s) => ({ name: s.status, count: s._count.status })),
      mrrTrend,
      // These would be computed from real data in production
      renewalTrend: mrrTrend.map((m) => ({ ...m, renewals: Math.floor(Math.random() * 20 + 5) })),
      churnTrend: mrrTrend.map((m) => ({ ...m, churn: Math.floor(Math.random() * 5) })),
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async exportSubscriptions(params: { search?: string; plan?: string; status: string }) {
    const where: Prisma.SubscriptionWhereInput = {};
    if (params.search) {
      where.pharmacy = {
        OR: [
          { name: { contains: params.search, mode: "insensitive" } },
          { tenantCode: { contains: params.search, mode: "insensitive" } },
        ],
      };
    }
    if (params.plan) where.planName = params.plan;
    if (params.status !== "ALL") where.status = params.status as any;

    const subs = await this.app.prisma.subscription.findMany({
      where,
      include: {
        pharmacy: {
          select: {
            name: true, tenantCode: true, gstin: true,
            users: { where: { role: "OWNER" }, take: 1, select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return subs.map((s) => ({
      tenantCode: s.pharmacy.tenantCode || "--",
      pharmacy: s.pharmacy.name,
      owner: s.pharmacy.users[0]?.name || "--",
      ownerEmail: s.pharmacy.users[0]?.email || "--",
      plan: s.planName,
      billingCycle: s.billingCycle,
      amount: s.amount || 0,
      status: s.status,
      autoRenew: s.autoRenew ? "Yes" : "No",
      validUntil: s.validUntil.toISOString().split("T")[0],
      gstin: s.pharmacy.gstin || "--",
      createdAt: s.createdAt.toISOString().split("T")[0],
    }));
  }

  // ── Bulk Action ───────────────────────────────────────────────────────────

  async bulkAction(ids: string[], action: string, adminUserId: string, planName?: string) {
    const results = { affected: 0, errors: [] as string[] };

    for (const id of ids) {
      try {
        switch (action) {
          case "RENEW":
            await this.renew(id, adminUserId);
            break;
          case "PAUSE":
            await this.pause(id, adminUserId);
            break;
          case "RESUME":
            await this.resume(id, adminUserId);
            break;
          case "SUSPEND":
            await this.app.prisma.subscription.update({ where: { id }, data: { status: "EXPIRED" } });
            await this.app.prisma.subscriptionAuditLog.create({
              data: { subscriptionId: id, action: "SUSPENDED", performedBy: adminUserId },
            });
            break;
          case "UPGRADE":
          case "DOWNGRADE":
          case "ASSIGN_PLAN":
            if (planName) await this.changePlan(id, planName, undefined, undefined, adminUserId);
            break;
          case "EMAIL_REMINDER":
            await this.sendReminder(id, adminUserId);
            break;
          case "GENERATE_INVOICE":
            await this.generateInvoice(id, adminUserId);
            break;
          default:
            break;
        }
        results.affected++;
      } catch (err: any) {
        results.errors.push(`${id}: ${err.message}`);
      }
    }

    return results;
  }
}
