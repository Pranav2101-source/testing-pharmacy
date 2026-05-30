import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { AuthRepo } from "./auth.repo.js";
import type { LoginInput, RegisterInput, RefreshInput } from "./auth.schema.js";
import type { JwtPayload } from "../../middleware/auth.js";

export class AuthService {
  private repo: AuthRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new AuthRepo(app.prisma);
  }

  async register(input: RegisterInput) {
    const slug = input.pharmacyName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50);

    const passwordHash = await bcrypt.hash(input.password, 12);

    const tenant = await this.repo.createTenantWithOwner({
      tenantName: input.pharmacyName,
      slug: `${slug}-${Date.now()}`,
      ownerName: input.ownerName,
      email: input.email,
      passwordHash,
      phone: input.phone,
      gstin: input.gstin,
      drugLicense: input.drugLicense,
      address: input.address,
      city: input.city,
      state: input.state,
      pincode: input.pincode,
    });

    const owner = tenant.users[0];
    if (!owner) {
      throw Object.assign(new Error("Failed to create owner account"), { statusCode: 500 });
    }

    return this.signTokens(owner.id, tenant.id, "OWNER", owner.email);
  }

  async login(input: LoginInput) {
    const user = await this.repo.findUserByEmail(input.email);

    // Constant-time guard: always compare even when user is not found to prevent
    // timing-based user enumeration.
    const hash = user?.passwordHash ?? "$2b$12$invalidhashpadding000000000000000000000000000000000000";
    const valid = await bcrypt.compare(input.password, hash);

    if (!user || !user.isActive || !valid) {
      throw Object.assign(new Error("Invalid credentials"), { statusCode: 401 });
    }
    if (!user.tenant.isActive) {
      throw Object.assign(new Error("Pharmacy account is inactive"), { statusCode: 403 });
    }

    await this.repo.updateLastLogin(user.id);

    return {
      tokens: this.signTokens(user.id, user.tenantId, user.role, user.email),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
      },
    };
  }

  async refresh(input: RefreshInput) {
    let payload: JwtPayload;
    try {
      payload = this.app.jwt.verify<JwtPayload>(input.refreshToken);
    } catch {
      // Covers expired, malformed, and wrong-signature tokens
      throw Object.assign(new Error("Invalid or expired refresh token"), { statusCode: 401 });
    }

    // Reject access tokens submitted to the refresh endpoint
    if (payload.type !== "refresh") {
      throw Object.assign(new Error("Invalid token type"), { statusCode: 401 });
    }

    // Re-validate against DB — user or tenant may have been deactivated since the
    // token was issued, and we cannot revoke JWTs otherwise.
    const user = await this.repo.findUserById(payload.sub);
    if (!user || !user.isActive) {
      throw Object.assign(new Error("User account is inactive"), { statusCode: 401 });
    }
    if (!user.tenant.isActive) {
      throw Object.assign(new Error("Pharmacy account is inactive"), { statusCode: 403 });
    }

    // Issue a fresh token pair (implicit refresh-token rotation)
    return this.signTokens(user.id, user.tenantId, user.role, user.email);
  }

  private signTokens(userId: string, tenantId: string, role: "OWNER" | "PHARMACIST", email: string) {
    const base = { sub: userId, tenantId, role, email };
    const accessToken = this.app.jwt.sign({ ...base, type: "access" });
    const refreshToken = this.app.jwt.sign(
      { ...base, type: "refresh" },
      { expiresIn: "7d" }
    );
    return { accessToken, refreshToken };
  }
}
