import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { AuthRepo } from "./auth.repo.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

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
    if (!owner) throw new Error("Failed to create owner");

    return this.signTokens(owner.id, tenant.id, "OWNER", owner.email);
  }

  async login(input: LoginInput) {
    const user = await this.repo.findUserByEmail(input.email);
    if (!user || !user.isActive) {
      throw { statusCode: 401, message: "Invalid credentials" };
    }
    if (!user.tenant.isActive) {
      throw { statusCode: 403, message: "Pharmacy account is inactive" };
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw { statusCode: 401, message: "Invalid credentials" };
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

  private signTokens(userId: string, tenantId: string, role: string, email: string) {
    const payload = { sub: userId, tenantId, role, email };
    const accessToken = this.app.jwt.sign(payload);
    const refreshToken = this.app.jwt.sign(payload, { expiresIn: "7d" });
    return { accessToken, refreshToken };
  }
}
