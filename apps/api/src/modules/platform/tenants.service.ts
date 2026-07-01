import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@pharmacy/database";
import type { CreateTenantInput } from "./tenants.schema.js";
import { auditService } from "../audit/audit.service.js";

export class TenantsService {
  constructor(private app: FastifyInstance) {}

  // ── Generate Tenant Code ──────────────────────────────────────────────────

  private async generateTenantCode(): Promise<string> {
    const last = await this.app.prisma.pharmacy.findFirst({
      where: { tenantCode: { not: null } },
      orderBy: { tenantCode: "desc" },
      select: { tenantCode: true },
    });
    let nextNum = 1;
    if (last?.tenantCode) {
      const match = last.tenantCode.match(/TEN-(\d+)/);
      if (match) nextNum = parseInt(match[1]!, 10) + 1;
    }
    return `TEN-${String(nextNum).padStart(6, "0")}`;
  }

  // ── Generate Secure Password ──────────────────────────────────────────────

  private generateSecurePassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    const bytes = crypto.randomBytes(16);
    let password = "";
    for (let i = 0; i < 16; i++) {
      password += chars[bytes[i]! % chars.length];
    }
    return password;
  }

  // ── Create Tenant ─────────────────────────────────────────────────────────

  async createTenant(input: CreateTenantInput, adminUserId: string) {
    const tenantCode = await this.generateTenantCode();
    const temporaryPassword = this.generateSecurePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    const slug = input.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50);

    // Check for duplicate pharmacy name or owner email
    const existingPharmacy = await this.app.prisma.pharmacy.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" } },
    });
    if (existingPharmacy) {
      throw Object.assign(new Error("A pharmacy with this name already exists"), { statusCode: 409 });
    }

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    const pharmacy = await this.app.prisma.pharmacy.create({
      data: {
        tenantCode,
        name: input.name,
        slug: `${slug}-${Date.now()}`,
        gstin: input.gstin || null,
        drugLicense: input.drugLicense || null,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        city: input.city || null,
        state: input.state || null,
        pincode: input.pincode || null,
        isActive: true,
        tenantStatus: "ACTIVE",
        subscription: {
          create: {
            planName: input.planName || "Free",
            status: "ACTIVE",
            validUntil,
            billingCycle: "MONTHLY",
            amount: 0,
            autoRenew: true,
          },
        },
        tenantSettings: {
          create: {
            doctorLimit: input.doctorLimit,
            staffLimit: input.staffLimit,
            patientLimit: input.patientLimit,
            storageLimit: input.storageLimit,
            enableBilling: input.enableBilling,
            enableInventory: input.enableInventory,
            enableEmr: input.enableEmr,
            enableCrm: input.enableCrm,
            enableWhatsapp: input.enableWhatsapp,
            enableSms: input.enableSms,
            enableApiAccess: input.enableApiAccess,
            enableOnlineBooking: input.enableOnlineBooking,
          },
        },
        users: {
          create: {
            name: input.ownerName,
            email: input.ownerEmail,
            phone: input.ownerPhone || null,
            passwordHash,
            role: "OWNER",
          },
        },
      },
      include: {
        subscription: true,
        tenantSettings: true,
        users: { where: { role: "OWNER" }, take: 1, select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    void auditService.log(null, {
      pharmacyId: pharmacy.id,
      userId: adminUserId,
      module: "TENANTS",
      action: "TENANT_CREATED",
      entity: "PHARMACY",
      entityId: pharmacy.id,
      resourceName: pharmacy.name,
      severity: "INFO",
      status: "SUCCESS",
      newData: { tenantCode, name: input.name, plan: input.planName },
    });

    if (pharmacy.subscription) {
      void auditService.log(null, {
        pharmacyId: pharmacy.id,
        userId: adminUserId,
        module: "SUBSCRIPTIONS",
        action: "SUBSCRIPTION_CREATED",
        entity: "SUBSCRIPTION",
        entityId: pharmacy.subscription.id,
        severity: "INFO",
        status: "SUCCESS",
        newData: { plan: pharmacy.subscription.planName },
      });
    }

    return {
      pharmacy: {
        id: pharmacy.id,
        tenantCode: pharmacy.tenantCode,
        name: pharmacy.name,
        owner: pharmacy.users[0] || null,
        subscription: pharmacy.subscription,
        settings: pharmacy.tenantSettings,
      },
      temporaryPassword,
    };
  }

  // ── Update Tenant Status ──────────────────────────────────────────────────

  async updateTenantStatus(
    id: string,
    status: "ACTIVE" | "SUSPENDED" | "ARCHIVED" | "TRIAL" | "EXPIRED",
    adminUserId: string
  ) {
    const pharmacy = await this.app.prisma.pharmacy.findUnique({ where: { id } });
    if (!pharmacy) throw Object.assign(new Error("Tenant not found"), { statusCode: 404 });

    const isActive = status === "ACTIVE" || status === "TRIAL";

    const updated = await this.app.prisma.pharmacy.update({
      where: { id },
      data: {
        tenantStatus: status,
        isActive,
      },
    });

    // If suspending or archiving, bump token versions to force logout
    if (status === "SUSPENDED" || status === "ARCHIVED" || status === "EXPIRED") {
      await this.app.prisma.user.updateMany({
        where: { pharmacyId: id },
        data: { tokenVersion: { increment: 1 } },
      });
    }

    // Audit log — use admin's own user record
    void auditService.log(null, {
      pharmacyId: id,
      userId: adminUserId,
      module: "TENANTS",
      action: `STATUS_CHANGED_TO_${status}`,
      entity: "PHARMACY",
      entityId: id,
      severity: "INFO",
      status: "SUCCESS",
      oldData: { status: pharmacy.tenantStatus },
      newData: { status },
    });

    return updated;
  }

  // ── Bulk Action ───────────────────────────────────────────────────────────

  async bulkAction(
    ids: string[],
    action: "SUSPEND" | "ACTIVATE" | "ARCHIVE",
    adminUserId: string
  ) {
    const statusMap = {
      SUSPEND: "SUSPENDED" as const,
      ACTIVATE: "ACTIVE" as const,
      ARCHIVE: "ARCHIVED" as const,
    };
    const targetStatus = statusMap[action];
    const isActive = targetStatus === "ACTIVE";

    const result = await this.app.prisma.pharmacy.updateMany({
      where: { id: { in: ids } },
      data: { tenantStatus: targetStatus, isActive },
    });

    // If suspending/archiving, revoke sessions
    if (targetStatus !== "ACTIVE") {
      await this.app.prisma.user.updateMany({
        where: { pharmacyId: { in: ids } },
        data: { tokenVersion: { increment: 1 } },
      });
    }

    // Audit logs for each
    for (const pharmacyId of ids) {
      void auditService.log(null, {
        pharmacyId,
        userId: adminUserId,
        module: "TENANTS",
        action: `BULK_${action}`,
        entity: "PHARMACY",
        entityId: pharmacyId,
        severity: "INFO",
        status: "SUCCESS",
      });
    }

    return { affected: result.count };
  }

  // ── Import Tenants ────────────────────────────────────────────────────────

  async importTenants(rows: Array<Record<string, any>>, adminUserId: string) {
    const results = { imported: 0, skipped: 0, failed: 0, errors: [] as Array<{ row: number; email: string; reason: string }> };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        // Check duplicate
        const exists = await this.app.prisma.user.findFirst({
          where: { email: row.ownerEmail },
        });
        if (exists) {
          results.skipped++;
          results.errors.push({ row: i + 1, email: row.ownerEmail, reason: "Duplicate email" });
          continue;
        }

        await this.createTenant({
          name: row.name,
          ownerName: row.ownerName,
          ownerEmail: row.ownerEmail,
          ownerPhone: row.ownerPhone,
          gstin: row.gstin,
          drugLicense: row.drugLicense,
          address: row.address,
          city: row.city,
          state: row.state,
          pincode: row.pincode,
          phone: row.phone,
          email: row.email,
          planName: row.planName || "Free",
          doctorLimit: 5,
          staffLimit: 5,
          patientLimit: 500,
          storageLimit: 1024,
          enableBilling: true,
          enableInventory: true,
          enableEmr: false,
          enableCrm: false,
          enableWhatsapp: false,
          enableSms: false,
          enableApiAccess: false,
          enableOnlineBooking: false,
        }, adminUserId);
        results.imported++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({ row: i + 1, email: row.ownerEmail || "", reason: err.message || "Unknown error" });
      }
    }

    // Audit log
    const adminPharmacy = await this.app.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { pharmacyId: true },
    });
    if (adminPharmacy) {
      await this.app.prisma.auditLog.create({
        data: {
          pharmacyId: adminPharmacy.pharmacyId,
          userId: adminUserId,
          action: "IMPORTED_TENANTS",
          entity: "PHARMACY",
          newData: { imported: results.imported, skipped: results.skipped, failed: results.failed },
        },
      });
    }

    return results;
  }

  // ── Export Tenants ─────────────────────────────────────────────────────────

  async exportTenants(params: {
    search?: string;
    status: string;
    plan?: string;
    state?: string;
  }) {
    const { search, status, plan, state } = params;

    const where: Prisma.PharmacyWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { gstin: { contains: search, mode: "insensitive" } },
        { tenantCode: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status !== "ALL") {
      if (status === "ACTIVE") where.isActive = true;
      else if (status === "INACTIVE") where.isActive = false;
      else where.tenantStatus = status as any;
    }

    if (plan) {
      where.subscription = { planName: plan };
    }

    if (state) where.state = { equals: state, mode: "insensitive" };

    const pharmacies = await this.app.prisma.pharmacy.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        users: {
          where: { role: "OWNER" },
          take: 1,
          select: { name: true, email: true, phone: true, lastLoginAt: true },
        },
        subscription: { select: { planName: true, status: true, validUntil: true } },
        _count: { select: { doctors: true, customers: true } },
      },
    });

    return pharmacies.map((p) => ({
      tenantId: p.id,
      tenantCode: p.tenantCode || "--",
      pharmacyName: p.name,
      owner: p.users[0]?.name || "--",
      ownerEmail: p.users[0]?.email || "--",
      ownerPhone: p.users[0]?.phone || "--",
      plan: p.subscription?.planName || "Not Configured",
      status: p.tenantStatus,
      createdDate: p.createdAt.toISOString().split("T")[0],
      renewalDate: p.subscription?.validUntil?.toISOString().split("T")[0] || "--",
      doctors: p._count.doctors,
      patients: p._count.customers,
      storage: "--",
      lastLogin: p.users[0]?.lastLoginAt?.toISOString() || "--",
      subscriptionStatus: p.subscription?.status || "--",
    }));
  }

  // ── List Tenants (existing, updated for new fields) ───────────────────────

  async listTenants(params: {
    search?: string;
    status: string;
    plan?: string;
    state?: string;
    city?: string;
    page: number;
    limit: number;
    sortBy: "name" | "createdAt" | "doctors" | "patients";
    sortDesc: boolean;
  }) {
    const { search, status, plan, state, city, page, limit, sortBy, sortDesc } = params;

    const where: Prisma.PharmacyWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { gstin: { contains: search, mode: "insensitive" } },
        { tenantCode: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status !== "ALL") {
      if (status === "ACTIVE") where.isActive = true;
      else if (status === "INACTIVE") where.isActive = false;
      else where.tenantStatus = status as any;
    }

    if (plan) where.subscription = { planName: plan };
    if (state) where.state = { equals: state, mode: "insensitive" };
    if (city) where.city = { equals: city, mode: "insensitive" };

    const skip = (page - 1) * limit;

    const orderBy: Prisma.PharmacyOrderByWithRelationInput = {};
    if (sortBy === "name") {
      orderBy.name = sortDesc ? "desc" : "asc";
    } else if (sortBy === "createdAt") {
      orderBy.createdAt = sortDesc ? "desc" : "asc";
    } else if (sortBy === "doctors") {
      orderBy.doctors = { _count: sortDesc ? "desc" : "asc" };
    } else if (sortBy === "patients") {
      orderBy.customers = { _count: sortDesc ? "desc" : "asc" };
    }

    const [total, pharmacies] = await Promise.all([
      this.app.prisma.pharmacy.count({ where }),
      this.app.prisma.pharmacy.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          tenantCode: true,
          name: true,
          slug: true,
          isActive: true,
          tenantStatus: true,
          createdAt: true,
          state: true,
          city: true,
          _count: {
            select: { doctors: true, customers: true },
          },
          users: {
            where: { role: "OWNER" },
            take: 1,
            select: { name: true, email: true },
          },
          subscription: {
            select: { planName: true, status: true, validUntil: true },
          },
        },
      }),
    ]);

    return {
      data: pharmacies.map((p) => ({
        id: p.id,
        tenantCode: p.tenantCode,
        name: p.name,
        slug: p.slug,
        logoUrl: null,
        state: p.state,
        city: p.city,
        isActive: p.isActive,
        tenantStatus: p.tenantStatus,
        createdAt: p.createdAt,
        doctorsCount: p._count.doctors,
        patientsCount: p._count.customers,
        owner: p.users[0] ? { name: p.users[0].name, email: p.users[0].email } : null,
        subscription: p.subscription
          ? { planName: p.subscription.planName, status: p.subscription.status, validUntil: p.subscription.validUntil }
          : null,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Get Tenant ────────────────────────────────────────────────────────────

  async getTenant(id: string) {
    const pharmacy = await this.app.prisma.pharmacy.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: "OWNER" },
          take: 1,
          select: { name: true, email: true, phone: true },
        },
        subscription: true,
        tenantSettings: true,
        _count: {
          select: { doctors: true, customers: true, supportTickets: true },
        },
      },
    });

    if (!pharmacy) return null;

    return {
      ...pharmacy,
      owner: pharmacy.users[0] || null,
      doctorsCount: pharmacy._count.doctors,
      patientsCount: pharmacy._count.customers,
      ticketsCount: pharmacy._count.supportTickets,
    };
  }

  // ── Get Tenant Activity ───────────────────────────────────────────────────

  async getTenantActivity(id: string, limit: number = 20) {
    const logs = await this.app.prisma.auditLog.findMany({
      where: { pharmacyId: id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: { select: { name: true } },
      },
    });
    return logs;
  }
}
