import type { PrismaClient } from "@pharmacy/database";

export class AuthRepo {
  constructor(private db: PrismaClient) {}

  async findUserByEmail(email: string, tenantId?: string) {
    return this.db.user.findFirst({
      where: { email, ...(tenantId ? { tenantId } : {}) },
      include: { tenant: { select: { id: true, name: true, isActive: true } } },
    });
  }

  async createTenantWithOwner(data: {
    tenantName: string;
    slug: string;
    ownerName: string;
    email: string;
    passwordHash: string;
    phone: string;
    gstin?: string;
    drugLicense?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
  }) {
    return this.db.tenant.create({
      data: {
        name: data.tenantName,
        slug: data.slug,
        gstin: data.gstin,
        drugLicense: data.drugLicense,
        phone: data.phone,
        address: data.address,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        users: {
          create: {
            name: data.ownerName,
            email: data.email,
            phone: data.phone,
            passwordHash: data.passwordHash,
            role: "OWNER",
          },
        },
      },
      include: { users: true },
    });
  }

  async updateLastLogin(userId: string) {
    return this.db.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }
}
