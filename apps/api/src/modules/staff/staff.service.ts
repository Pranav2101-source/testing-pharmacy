import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import type { CreateStaffInput, UpdateStaffInput } from "./staff.schema.js";
import { AppError } from "../../lib/AppError.js";
import { invalidateTokenVersion } from "../../middleware/auth.js";

export class StaffService {
  constructor(private app: FastifyInstance) {}

  async create(pharmacyId: string, requesterId: string, input: CreateStaffInput) {
    const exists = await this.app.prisma.user.findFirst({
      where: { pharmacyId, email: input.email },
    });
    if (exists) throw AppError.conflict("Email already registered in this pharmacy");

    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.app.prisma.user.create({
      data: {
        pharmacyId,
        passwordHash,
        name:  input.name,
        email: input.email,
        phone: input.phone,
        role:  input.role,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });
  }

  async list(pharmacyId: string) {
    return this.app.prisma.user.findMany({
      where:   { pharmacyId },
      select:  { id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { name: "asc" },
    });
  }

  async update(id: string, pharmacyId: string, input: UpdateStaffInput) {
    // Verify the target user belongs to this pharmacy before updating
    const target = await this.app.prisma.user.findFirst({
      where: { id, pharmacyId },
    });
    if (!target) throw AppError.notFound("Staff member not found");

    // A role change must take effect immediately, not after the current access
    // token expires — otherwise a demoted user keeps their old privileges for up
    // to JWT_EXPIRES_IN. Bumping tokenVersion invalidates every outstanding
    // access + refresh token; the user is logged out and signs back in with the
    // new role.
    const roleChanged = input.role !== undefined && input.role !== target.role;

    // Prevent stripping the last active owner of their role — same invariant
    // as the deactivation guard. Without this check, a sole owner could change
    // their own role to Pharmacist and leave the pharmacy unreachable.
    if (roleChanged && target.role === "OWNER" && input.role !== "OWNER") {
      const activeOwnerCount = await this.app.prisma.user.count({
        where: { pharmacyId, role: "OWNER", isActive: true },
      });
      if (activeOwnerCount <= 1) {
        throw AppError.conflict("Cannot change the role of the last active owner");
      }
    }

    const updated = await this.app.prisma.user.update({
      where:  { id, pharmacyId },
      data:   { ...input, ...(roleChanged ? { tokenVersion: { increment: 1 } } : {}) },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
    });

    if (roleChanged) this.evictTokenVersionCache(id);

    return updated;
  }

  async deactivate(id: string, pharmacyId: string, requesterId: string) {
    if (id === requesterId) {
      throw AppError.badRequest("You cannot deactivate your own account");
    }

    const target = await this.app.prisma.user.findFirst({
      where: { id, pharmacyId },
    });
    if (!target) throw AppError.notFound("Staff member not found");

    // Prevent deactivating the last active OWNER
    if (target.role === "OWNER") {
      const activeOwnerCount = await this.app.prisma.user.count({
        where: { pharmacyId, role: "OWNER", isActive: true },
      });
      if (activeOwnerCount <= 1) {
        throw AppError.conflict("Cannot deactivate the last active owner of this pharmacy");
      }
    }

    // Bump tokenVersion alongside deactivation so every outstanding token is
    // rejected on the very next request (authenticate's Redis cache is evicted
    // below). Without this, a deactivated user could keep working until their
    // access token expired — the DB isActive check only runs on cache misses.
    const deactivated = await this.app.prisma.user.update({
      where: { id, pharmacyId },
      data:  { isActive: false, tokenVersion: { increment: 1 } },
    });

    this.evictTokenVersionCache(id);

    return deactivated;
  }

  private evictTokenVersionCache(userId: string): void {
    invalidateTokenVersion(userId);
  }
}
