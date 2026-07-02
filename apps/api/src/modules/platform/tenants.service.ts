import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@pharmacy/database";
import { Readable } from "stream";
import type { CreateTenantInput } from "./tenants.schema.js";
import { auditService } from "../audit/audit.service.js";
import { PharmacyOnboardingService } from "../pharmacy/pharmacy-onboarding.service.js";
export class TenantsService {
  constructor(private app: FastifyInstance) {}

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

  async createTenant(req: FastifyRequest | null, input: CreateTenantInput) {
    const temporaryPassword = this.generateSecurePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    const onboardingService = new PharmacyOnboardingService(this.app);
    const pharmacy = await onboardingService.onboardPharmacy(req, {
      pharmacyData: {
        name: input.name,
        gstin: input.gstin,
        drugLicense: input.drugLicense,
        phone: input.phone,
        email: input.email,
        address: input.address,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
      },
      tenantSettings: {
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
      ownerData: {
        name: input.ownerName,
        email: input.ownerEmail,
        phone: input.ownerPhone,
        passwordHash,
      },
      createOwner: true,
    });

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

  async importTenants(req: FastifyRequest | null, rows: Array<Record<string, any>>) {
    const results = { imported: 0, skipped: 0, failed: 0, errors: [] as Array<{ row: number; email: string; reason: string }> };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        await this.createTenant(req, {
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
        });
        results.imported++;
      } catch (err: any) {
        if (err.statusCode === 409) {
          results.skipped++;
          results.errors.push({ row: i + 1, email: row.ownerEmail || "", reason: err.message });
        } else {
          results.failed++;
          results.errors.push({ row: i + 1, email: row.ownerEmail || "", reason: err.message || "Unknown error" });
        }
      }
    }

    // Audit log
    const adminUserId = req ? (req as any).user?.id : null;
    if (adminUserId) {
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
    }

    return results;
  }

  // ── Export Tenants ─────────────────────────────────────────────────────────

  exportTenantsStream(params: {
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
    
    const prisma = this.app.prisma;

    async function* generateTenantsCsv() {
      yield "Tenant ID,Code,Pharmacy Name,Owner,Owner Email,Owner Phone,Plan,Status,Created Date,Renewal Date,Doctors,Patients,Storage,Last Login,Subscription Status\n";
      
      let cursor: string | undefined = undefined;

      while (true) {
        const pharmacies = await prisma.pharmacy.findMany({
          where,
          orderBy: { id: "asc" },
          take: 1000,
          skip: cursor ? 1 : 0,
          cursor: cursor ? { id: cursor } : undefined,
          include: {
            users: {
              where: { role: "OWNER" },
              take: 1,
              select: { name: true, email: true, phone: true, lastLoginAt: true },
            },
            subscription: { select: { planName: true, status: true, validUntil: true } },
            _count: { select: { doctors: true, customers: true } },
          },
        }) as any[];

        if (pharmacies.length === 0) break;

        let chunk = "";
        for (const p of pharmacies) {
          const owner = p.users[0]?.name || "--";
          const ownerEmail = p.users[0]?.email || "--";
          const ownerPhone = p.users[0]?.phone || "--";
          const plan = p.subscription?.planName || "Not Configured";
          const renewalDate = p.subscription?.validUntil?.toISOString().split("T")[0] || "--";
          const lastLogin = p.users[0]?.lastLoginAt?.toISOString() || "--";
          const subStatus = p.subscription?.status || "--";

          chunk += `"${p.id}","${p.tenantCode || '--'}","${p.name}","${owner}","${ownerEmail}","${ownerPhone}","${plan}","${p.tenantStatus}","${p.createdAt.toISOString().split("T")[0]}","${renewalDate}","${p._count.doctors}","${p._count.customers}","--","${lastLogin}","${subStatus}"\n`;
        }
        yield chunk;
        cursor = pharmacies[pharmacies.length - 1].id;
      }
    }

    return Readable.from(generateTenantsCsv());
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
