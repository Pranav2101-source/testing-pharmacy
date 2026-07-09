import type { Db } from "@pharmacy/database";

export class AuthRepo {
  constructor(private db: Db) {}

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
        tokenVersion:                { increment: 1 },
      },
    });
  }

  /** Change password in-session: update hash and rotate tokenVersion to invalidate all sessions. */
  async updatePasswordAndRotate(userId: string, newPasswordHash: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data:  {
        passwordHash: newPasswordHash,
        tokenVersion: { increment: 1 },
      },
    });
  }
}
