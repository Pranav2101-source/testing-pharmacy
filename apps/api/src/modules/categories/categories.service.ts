import type { FastifyInstance } from "fastify";
import { CategoriesRepo } from "./categories.repo.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "./categories.schema.js";
import { AppError } from "../../lib/AppError.js";

export class CategoriesService {
  private repo: CategoriesRepo;

  constructor(app: FastifyInstance) {
    this.repo = new CategoriesRepo(app.prisma);
  }

  async create(input: CreateCategoryInput) {
    const dup = await this.repo.checkDuplicate(input.name);
    if (dup) throw AppError.conflict(`Category "${input.name}" already exists`);
    return this.repo.create(input);
  }

  async update(id: string, input: UpdateCategoryInput) {
    const existing = await this.repo.getById(id);
    if (!existing) throw AppError.notFound("Category not found");
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await this.repo.checkDuplicate(input.name, id);
      if (dup) throw AppError.conflict(`Category "${input.name}" already exists`);
    }
    return this.repo.update(id, input);
  }

  async getById(id: string) {
    const cat = await this.repo.getById(id);
    if (!cat) throw AppError.notFound("Category not found");
    return cat;
  }

  async listAll() {
    return this.repo.listAll();
  }
}
