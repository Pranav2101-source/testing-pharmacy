import type { PrismaClient, Prisma, Medicine } from "@pharmacy/database";
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

  /**
   * Creates a chunk of medicines inside a single transaction.
   * Rows whose name already exists are skipped (not failed).
   * If any other error occurs the entire chunk is rolled back.
   */
  async createManyInTransaction(rows: CreateMedicineInput[]): Promise<{
    created: Medicine[];
    skipped: string[];
  }> {
    const created: Medicine[] = [];
    const skipped: string[] = [];

    await this.db.$transaction(async (tx) => {
      for (const row of rows) {
        const dup = await tx.medicine.findFirst({
          where: { name: { equals: row.name, mode: "insensitive" } },
        });
        if (dup) {
          skipped.push(row.name);
          continue;
        }
        const medicine = await tx.medicine.create({ data: row });
        created.push(medicine);
      }
    });

    return { created, skipped };
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

  async findByBarcode(barcode: string) {
    return this.db.medicine.findFirst({
      where: { barcode: { equals: barcode, mode: "insensitive" }, isActive: true },
    });
  }

  async findAlternatives(excludeId: string, genericName: string) {
    return this.db.medicine.findMany({
      where: {
        genericName: { equals: genericName, mode: "insensitive" },
        isActive:    true,
        id:          { not: excludeId },
      },
      include: { brand: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
  }
}
