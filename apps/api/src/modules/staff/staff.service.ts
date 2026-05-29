import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import type { CreateStaffInput, UpdateStaffInput } from "./staff.schema.js";

export class StaffService {
  constructor(private app: FastifyInstance) {}

  async create(tenantId: string, input: CreateStaffInput) {
    const exists = await this.app.prisma.user.findFirst({
      where: { tenantId, email: input.email },
    });
    if (exists) throw { statusCode: 409, message: "Email already registered" };

    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.app.prisma.user.create({
      data: { tenantId, passwordHash, name: input.name, email: input.email, phone: input.phone, role: input.role },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
  }

  async list(tenantId: string) {
    return this.app.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true },
      orderBy: { name: "asc" },
    });
  }

  async update(id: string, tenantId: string, input: UpdateStaffInput) {
    return this.app.prisma.user.update({
      where: { id },
      data: input,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
  }

  async deactivate(id: string, tenantId: string) {
    return this.app.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
