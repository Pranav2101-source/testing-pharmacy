import type { Db } from "@pharmacy/database";

export class BrandsRepo {
  constructor(private db: Db) {}

  async create(data: { name: string; manufacturer?: string; country?: string }) {
    return this.db.brand.create({ data });
  }

  async update(id: string, data: { name?: string; manufacturer?: string; country?: string; isActive?: boolean }) {
    return this.db.brand.update({ where: { id }, data });
  }

  async getById(id: string) {
    return this.db.brand.findUnique({ where: { id } });
  }

  async checkDuplicate(name: string, excludeId?: string) {
    return this.db.brand.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
  }

  async list(params: { page: number; limit: number; search?: string }) {
    const where = params.search
      ? { name: { contains: params.search, mode: "insensitive" as const } }
      : {};

    const [items, total] = await Promise.all([
      this.db.brand.findMany({
        where,
        orderBy: { name: "asc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
      }),
      this.db.brand.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  async listAll() {
    return this.db.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 500 });
  }
}
