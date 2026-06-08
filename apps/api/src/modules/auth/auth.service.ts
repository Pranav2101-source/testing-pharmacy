import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AuthRepo } from "./auth.repo.js";
import type { LoginInput, RegisterInput, RefreshInput, ForgotPasswordInput, ResetPasswordInput } from "./auth.schema.js";
import type { JwtPayload, UserRole } from "../../middleware/auth.js";
import { AppError } from "../../lib/AppError.js";
import { env } from "../../config/env.js";
import { notifyOwners } from "../../lib/notifications.js";

/** Convert a TTL string like "1h" / "30m" to milliseconds. */
function parseTtlMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(m|h|d)$/);
  if (!match) return 60 * 60 * 1000; // default 1h
  const n = parseInt(match[1]!, 10);
  const unit = match[2];
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000; // days
}

export class AuthService {
  private repo: AuthRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new AuthRepo(app.prisma);
  }

  // ── Register ──────────────────────────────────────────────────────────────

  async register(input: RegisterInput) {
    const slug = input.pharmacyName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50);

    const passwordHash = await bcrypt.hash(input.password, 12);

    const pharmacy = await this.repo.createPharmacyWithOwner({
      pharmacyName: input.pharmacyName,
      slug:         `${slug}-${Date.now()}`,
      ownerName:    input.ownerName,
      email:        input.email,
      passwordHash,
      phone:        input.phone,
      gstin:        input.gstin,
      drugLicense:  input.drugLicense,
      address:      input.address,
      city:         input.city,
      state:        input.state,
      pincode:      input.pincode,
    });

    const owner = pharmacy.users[0];
    if (!owner) {
      throw AppError.internal("Failed to create owner account");
    }

    return this.signTokens(owner.id, pharmacy.id, "OWNER", owner.email, owner.tokenVersion);
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(input: LoginInput) {
    const user = await this.repo.findUserByEmail(input.email);

    // Constant-time guard: always compare to prevent timing-based user enumeration
    const hash  = user?.passwordHash ?? "$2b$12$invalidhashpadding000000000000000000000000000000000000";
    const valid = await bcrypt.compare(input.password, hash);

    if (!user || !user.isActive || !valid) {
      throw AppError.unauthorized("Invalid credentials");
    }
    if (!user.pharmacy.isActive) {
      throw AppError.forbidden("Pharmacy account is inactive");
    }

    await this.repo.updateLastLogin(user.id);

    // Notify owner when a non-owner staff member logs in
    if (user.role !== "OWNER") {
      const loginTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
      void notifyOwners(this.app.prisma, user.pharmacyId, {
        subject: `👤 Staff login — ${user.name}`,
        message: `${user.name} (${user.role}) logged into ${user.pharmacy.name} at ${loginTime} IST.`,
      });
    }

    return {
      tokens: this.signTokens(user.id, user.pharmacyId, user.role, user.email, user.tokenVersion),
      user: {
        id:           user.id,
        name:         user.name,
        email:        user.email,
        role:         user.role,
        pharmacyId:   user.pharmacyId,
        pharmacyName: user.pharmacy.name,
      },
    };
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async refresh(input: RefreshInput) {
    let payload: JwtPayload;
    try {
      payload = this.app.jwt.verify<JwtPayload>(input.refreshToken);
    } catch {
      throw AppError.unauthorized("Invalid or expired refresh token");
    }

    if (payload.type !== "refresh") {
      throw AppError.unauthorized("Invalid token type");
    }

    const user = await this.repo.findUserById(payload.sub);
    if (!user || !user.isActive) {
      throw AppError.unauthorized("User account is inactive");
    }
    if (!user.pharmacy.isActive) {
      throw AppError.forbidden("Pharmacy account is inactive");
    }

    // Refresh token rotation: reject if the token's version is stale
    if (payload.tokenVersion !== user.tokenVersion) {
      throw AppError.unauthorized("Refresh token has been revoked");
    }

    // Increment tokenVersion — this invalidates the submitted refresh token so
    // it cannot be reused even if intercepted
    const newVersion = await this.repo.rotateTokenVersion(user.id);

    return this.signTokens(user.id, user.pharmacyId, user.role, user.email, newVersion);
  }

  // ── Forgot password ───────────────────────────────────────────────────────

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.repo.findUserByEmail(input.email);

    // Always succeed to prevent email enumeration
    if (!user || !user.isActive) return;

    // Generate a cryptographically random token; store its SHA-256 hash in DB
    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash  = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt  = new Date(Date.now() + parseTtlMs(env.PASSWORD_RESET_TOKEN_TTL));

    await this.repo.setPasswordResetToken(user.id, tokenHash, expiresAt);

    if (env.NODE_ENV === "development") {
      this.app.log.info(
        { userId: user.id, resetToken: plainToken },
        "Password reset token (local dev only — never logs in test or production)",
      );
    }

    // Send password reset email via SMTP (falls back gracefully if not configured)
    const { sendMail } = await import("../../lib/mailer.js");
    await sendMail({
      to:      user.email,
      subject: "Reset your Checkup Pharmacy password",
      html: `<p style="font-family:Arial,sans-serif">Hi ${user.name},</p>
        <p>A password reset was requested for your account. Use the token below within ${env.PASSWORD_RESET_TOKEN_TTL}:</p>
        <p style="font-size:18px;font-weight:bold;letter-spacing:2px">${plainToken}</p>
        <p>If you didn't request this, ignore this email — your password won't change.</p>`,
      text: `Hi ${user.name},\n\nYour password reset token: ${plainToken}\n\nExpires in ${env.PASSWORD_RESET_TOKEN_TTL}.`,
    }).catch(() => {});
  }

  // ── Reset password ────────────────────────────────────────────────────────

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
    const user      = await this.repo.findUserByPasswordResetToken(tokenHash);

    if (!user || !user.passwordResetTokenExpiresAt) {
      throw AppError.badRequest("Invalid or expired reset token");
    }
    if (user.passwordResetTokenExpiresAt < new Date()) {
      throw AppError.badRequest("Reset token has expired — request a new one");
    }

    const newPasswordHash = await bcrypt.hash(input.newPassword, 12);

    // consumePasswordResetToken also increments tokenVersion, logging out all sessions
    await this.repo.consumePasswordResetToken(user.id, newPasswordHash);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private signTokens(
    userId:       string,
    pharmacyId:   string,
    role:         UserRole,
    email:        string,
    tokenVersion: number,
  ) {
    const base = { sub: userId, pharmacyId, role, email, tokenVersion };
    const accessToken  = this.app.jwt.sign({ ...base, type: "access" });
    const refreshToken = this.app.jwt.sign(
      { ...base, type: "refresh" },
      { expiresIn: "7d" },
    );
    return { accessToken, refreshToken };
  }
}
