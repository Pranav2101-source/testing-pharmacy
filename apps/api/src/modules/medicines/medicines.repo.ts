import type { PrismaClient, Prisma } from "@pharmacy/database";
import type { CreateMedicineInput, UpdateMedicineInput } from "./medicines.schema.js";

export class MedicinesRepo {
  constructor(private db: PrismaClient) {}

  async create(data: CreateMedicineInput) {
    return this.db.medicine.create({ data });
  }

  async update(id: string, data: UpdateMedicineInput) {
    return this.db.medicine.update({ where: { id }, data });
  }

  async getById(id: string) {
    return this.db.medicine.findUnique({ where: { id } });
  }

  async checkDuplicate(name: string, excludeId?: string) {
    return this.db.medicine.findFirst({
      where: {
        name:        { equals: name, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async list(params: {
    page:      number;
    limit:     number;
    search?:   string;
    category?: string;
    schedule?: string;
    form?:     string;
    isActive?: boolean;
  }) {
    const skip = (params.page - 1) * params.limit;

    const where: Prisma.MedicineWhereInput = {
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.category ? { category: { contains: params.category, mode: "insensitive" } } : {}),
      ...(params.schedule ? { schedule: params.schedule } : {}),
      ...(params.form     ? { form: params.form } : {}),
      ...(params.search   ? {
        OR: [
          { name:         { contains: params.search, mode: "insensitive" } },
          { genericName:  { contains: params.search, mode: "insensitive" } },
          { manufacturer: { contains: params.search, mode: "insensitive" } },
          { composition:  { contains: params.search, mode: "insensitive" } },
        ],
      } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.medicine.findMany({
        where,
        skip,
        take:    params.limit,
        orderBy: { name: "asc" },
      }),
      this.db.medicine.count({ where }),
    ]);

    return {
      items,
      total,
      page:       params.page,
      limit:      params.limit,
      totalPages: Math.ceil(total / params.limit),
    };
  }

  async listAll() {
    return this.db.medicine.findMany({ orderBy: { name: "asc" } });
  }
}
