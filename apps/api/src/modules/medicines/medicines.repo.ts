import type { Db, Prisma, Medicine } from "@pharmacy/database";
import type { CreateMedicineInput, UpdateMedicineInput } from "./medicines.schema.js";

// The generated Medicine type carries Prisma.Decimal for money fields; the
// extended client (see packages/database client.ts) converts them to number.
export type MedicineRecord = Omit<Medicine, "gstRate" | "catalogMrp"> & {
  gstRate:    number;
  catalogMrp: number | null;
};

export class MedicinesRepo {
  constructor(private db: Db) {}

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
    created: MedicineRecord[];
    skipped: string[];
  }> {
    const created: MedicineRecord[] = [];
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

  /**
   * Checks which medicines in a search result set have alternatives in the
   * global catalog (same genericName + strength + form, different id).
   * Single query — safe to call on every search response.
   */
  async checkAlternativesExist(
    medicines: Array<{ id: string; genericName: string | null; strength: string | null; form: string | null }>,
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>(medicines.map((m) => [m.id, false]));
    const withGeneric = medicines.filter((m) => m.genericName);
    if (withGeneric.length === 0) return result;

    // Fetch every medicine sharing any of the genericNames present in the results.
    // The result set is bounded by the search limit (≤50), so genericNames ≤50.
    const genericNames = [...new Set(withGeneric.map((m) => m.genericName!.toLowerCase()))];

    const candidates = await this.db.medicine.findMany({
      where: {
        genericName: { in: genericNames, mode: "insensitive" },
        isActive:    true,
      },
      select: { id: true, genericName: true, strength: true, form: true },
    });

    for (const m of withGeneric) {
      const hasAlt = candidates.some(
        (c) =>
          c.id !== m.id &&
          c.genericName?.toLowerCase() === m.genericName!.toLowerCase() &&
          (!m.strength || c.strength?.toLowerCase() === m.strength.toLowerCase()) &&
          (!m.form || c.form?.toLowerCase() === m.form.toLowerCase()),
      );
      result.set(m.id, hasAlt);
    }

    return result;
  }

  /**
   * Finds alternative medicines matching genericName + strength + form and
   * joins with the pharmacy's live inventory so the caller gets stock data
   * without a second round-trip.
   */
  async findAlternatives(
    pharmacyId: string,
    excludeId: string,
    params: { genericName: string; strength: string | null; form: string | null },
  ) {
    return this.db.medicine.findMany({
      where: {
        genericName: { equals: params.genericName, mode: "insensitive" },
        ...(params.strength ? { strength: { equals: params.strength, mode: "insensitive" } } : {}),
        ...(params.form     ? { form:    { equals: params.form,    mode: "insensitive" } } : {}),
        isActive: true,
        id:       { not: excludeId },
      },
      include: {
        brand: { select: { id: true, name: true } },
        inventory: {
          where: {
            pharmacyId,
            status:     "ACTIVE",
            expiryDate: { gt: new Date() },
          },
          select: {
            id:               true,
            batchNumber:      true,
            expiryDate:       true,
            quantity:         true,
            reservedQuantity: true,
            mrp:              true,
            purchaseRate:     true,
            location:         true,
          },
        },
      },
      orderBy: { name: "asc" },
    });
  }
}
