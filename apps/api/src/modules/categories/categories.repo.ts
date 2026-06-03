import type { PrismaClient } from "@pharmacy/database";

export class CategoriesRepo {
  constructor(private db: PrismaClient) {}

  async create(data: { name: string; code?: string; description?: string; parentId?: string }) {
    return this.db.productCategory.create({
      data,
      include: { parent: { select: { id: true, name: true } } },
    });
  }

  async update(id: string, data: { name?: string; code?: string; description?: string; parentId?: string; isActive?: boolean }) {
    return this.db.productCategory.update({
      where: { id },
      data,
      include: { parent: { select: { id: true, name: true } } },
    });
  }

  async getById(id: string) {
    return this.db.productCategory.findUnique({
      where:   { id },
      include: { parent: { select: { id: true, name: true } }, children: { select: { id: true, name: true, isActive: true } } },
    });
  }

  async checkDuplicate(name: string, excludeId?: string) {
    return this.db.productCategory.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
  }

  // Returns flat list with parent info — frontend builds tree if needed
  async listAll() {
    return this.db.productCategory.findMany({
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
      include: { parent: { select: { id: true, name: true } } },
    });
  }
}
