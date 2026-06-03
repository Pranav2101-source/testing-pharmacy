import type { PrismaClient } from "@pharmacy/database";

export class AuthRepo {
  constructor(private db: PrismaClient) {}

  async findUserByEmail(email: string, pharmacyId?: string) {
    return this.db.user.findFirst({
      where: { email, ...(pharmacyId ? { pharmacyId } : {}) },
      include: { pharmacy: { select: { id: true, name: true, isActive: true } } },
    });
  }

  async findUserById(userId: string) {
    return this.db.user.findUnique({
      where:   { id: userId },
      include: { pharmacy: { select: { id: true, name: true, isActive: true } } },
    });
  }

  async createPharmacyWithOwner(data: {
    pharmacyName:  string;
    slug:          string;
    ownerName:     string;
    email:         string;
    passwordHash:  string;
    phone:         string;
    gstin?:        string;
    drugLicense?:  string;
    address?:      string;
    city?:         string;
    state?:        string;
    pincode?:      string;
  }) {
    return this.db.pharmacy.create({
      data: {
        name:        data.pharmacyName,
        slug:        data.slug,
        gstin:       data.gstin,
        drugLicense: data.drugLicense,
        phone:       data.phone,
        address:     data.address,
        city:        data.city,
        state:       data.state,
        pincode:     data.pincode,
        users: {
          create: {
            name:         data.ownerName,
            email:        data.email,
            phone:        data.phone,
            passwordHash: data.passwordHash,
            role:         "OWNER",
          },
        },
      },
      include: { users: true },
    });
  }

  async updateLastLogin(userId: string) {
    return this.db.user.update({
      where: { id: userId },
      data:  { lastLoginAt: new Date() },
    });
  }

  /** Increment tokenVersion to invalidate ALL existing refresh tokens for this user. */
  async rotateTokenVersion(userId: string): Promise<number> {
    const updated = await this.db.user.update({
      where:  { id: userId },
      data:   { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return updated.tokenVersion;
  }

  // ── Password reset ────────────────────────────────────────────────────────

  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.user.update({
      where: { id: userId },
      data:  {
        passwordResetToken:          tokenHash,
        passwordResetTokenExpiresAt: expiresAt,
      },
    });
  }

  async findUserByPasswordResetToken(tokenHash: string) {
    return this.db.user.findUnique({
      where: { passwordResetToken: tokenHash },
    });
  }

  async consumePasswordResetToken(userId: string, newPasswordHash: string) {
    return this.db.user.update({
      where: { id: userId },
      data:  {
        passwordHash:                newPasswordHash,
        passwordResetToken:          null,
        passwordResetTokenExpiresAt: null,
        tokenVersion:                { increment: 1 }, // invalidate all existing sessions
      },
    });
  }
}
