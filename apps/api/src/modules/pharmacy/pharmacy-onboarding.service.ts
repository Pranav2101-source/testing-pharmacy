import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@pharmacy/database";
import { auditService } from "../audit/audit.service.js";
import { DEFAULT_SUBSCRIPTION } from "./pharmacy.constants.js";

export interface OnboardPharmacyParams {
  pharmacyData: {
    name: string;
    slug?: string;
    gstin?: string | null;
    drugLicense?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  };
  tenantSettings?: {
    doctorLimit?: number;
    staffLimit?: number;
    patientLimit?: number;
    storageLimit?: number;
    enableBilling?: boolean;
    enableInventory?: boolean;
    enableEmr?: boolean;
    enableCrm?: boolean;
    enableWhatsapp?: boolean;
    enableSms?: boolean;
    enableApiAccess?: boolean;
    enableOnlineBooking?: boolean;
  };
  ownerData?: {
    name: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
  };
  createOwner?: boolean;
}

export class PharmacyOnboardingService {
  constructor(private app: FastifyInstance) {}

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

  async onboardPharmacy(req: FastifyRequest | null, params: OnboardPharmacyParams) {
    const { pharmacyData, tenantSettings, ownerData } = params;
    const createOwner = params.createOwner ?? true;

    if (createOwner && !ownerData) {
      throw Object.assign(new Error("Owner data is required when createOwner is true"), { statusCode: 400 });
    }

    const tenantCode = await this.generateTenantCode();

    const slug = pharmacyData.slug || pharmacyData.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50) + `-${Date.now()}`;

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    try {
      const pharmacy = await this.app.prisma.$transaction(async (tx) => {
        if (createOwner && ownerData) {
          // Manually enforce global email uniqueness since DB only has @@unique([pharmacyId, email])
          const existingUser = await tx.user.findFirst({ where: { email: ownerData.email } });
          if (existingUser) {
            throw Object.assign(new Error("This email is already registered."), { statusCode: 409 });
          }
        }

        return tx.pharmacy.create({
          data: {
            tenantCode,
            name: pharmacyData.name,
            slug,
            gstin: pharmacyData.gstin || null,
            drugLicense: pharmacyData.drugLicense || null,
            phone: pharmacyData.phone || null,
            email: pharmacyData.email || null,
            address: pharmacyData.address || null,
            city: pharmacyData.city || null,
            state: pharmacyData.state || null,
            pincode: pharmacyData.pincode || null,
            isActive: true,
            tenantStatus: "ACTIVE",
            subscription: {
              create: {
                planName: DEFAULT_SUBSCRIPTION.planName,
                status: DEFAULT_SUBSCRIPTION.status,
                billingCycle: DEFAULT_SUBSCRIPTION.billingCycle,
                amount: DEFAULT_SUBSCRIPTION.amount,
                autoRenew: DEFAULT_SUBSCRIPTION.autoRenew,
                validUntil,
              },
            },
            tenantSettings: {
              create: {
                doctorLimit: tenantSettings?.doctorLimit ?? 5,
                staffLimit: tenantSettings?.staffLimit ?? 5,
                patientLimit: tenantSettings?.patientLimit ?? 500,
                storageLimit: tenantSettings?.storageLimit ?? 1024,
                enableBilling: tenantSettings?.enableBilling ?? true,
                enableInventory: tenantSettings?.enableInventory ?? true,
                enableEmr: tenantSettings?.enableEmr ?? false,
                enableCrm: tenantSettings?.enableCrm ?? false,
                enableWhatsapp: tenantSettings?.enableWhatsapp ?? false,
                enableSms: tenantSettings?.enableSms ?? false,
                enableApiAccess: tenantSettings?.enableApiAccess ?? false,
                enableOnlineBooking: tenantSettings?.enableOnlineBooking ?? false,
              },
            },
            ...(createOwner && ownerData
              ? {
                  users: {
                    create: {
                      name: ownerData.name,
                      email: ownerData.email,
                      phone: ownerData.phone || null,
                      passwordHash: ownerData.passwordHash,
                      role: "OWNER",
                    },
                  },
                }
              : {}),
          },
          include: {
            subscription: true,
            tenantSettings: true,
            users: { where: { role: "OWNER" }, take: 1, select: { id: true, name: true, email: true, tokenVersion: true } },
          },
        });
      });

      // Audit logs
      if (req) {
        void auditService.log(req, {
          pharmacyId: pharmacy.id,
          module: "TENANTS",
          action: "TENANT_CREATED",
          entity: "PHARMACY",
          entityId: pharmacy.id,
          resourceName: pharmacy.name,
          severity: "INFO",
          status: "SUCCESS",
          newData: { tenantCode, name: pharmacy.name, plan: DEFAULT_SUBSCRIPTION.planName },
        });

        if (pharmacy.subscription) {
          void auditService.log(req, {
            pharmacyId: pharmacy.id,
            module: "SUBSCRIPTIONS",
            action: "SUBSCRIPTION_CREATED",
            entity: "SUBSCRIPTION",
            entityId: pharmacy.subscription.id,
            severity: "INFO",
            status: "SUCCESS",
            newData: { plan: pharmacy.subscription.planName },
          });
        }
      }

      return pharmacy;
    } catch (error: any) {
      if (error.code === "P2002") {
        const target = error.meta?.target;
        let message = "A conflict occurred during creation.";
        
        if (Array.isArray(target)) {
          if (target.includes("slug")) message = "A pharmacy with this slug already exists.";
          else if (target.includes("tenantCode")) message = "A pharmacy with this tenant code already exists.";
        } else if (typeof target === 'string') {
           if (target.includes("slug")) message = "A pharmacy with this slug already exists.";
           else if (target.includes("tenantCode")) message = "A pharmacy with this tenant code already exists.";
        }

        throw Object.assign(new Error(message), { statusCode: 409 });
      }
      throw error;
    }
  }
}
