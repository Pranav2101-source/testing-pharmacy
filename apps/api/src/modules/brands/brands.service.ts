import type { FastifyInstance } from "fastify";
import { BrandsRepo } from "./brands.repo.js";
import type { CreateBrandInput, UpdateBrandInput, ListBrandsQuery } from "./brands.schema.js";
import { AppError } from "../../lib/AppError.js";

export class BrandsService {
  private repo: BrandsRepo;

  constructor(app: FastifyInstance) {
    this.repo = new BrandsRepo(app.prisma);
  }

  async create(input: CreateBrandInput) {
    const dup = await this.repo.checkDuplicate(input.name);
    if (dup) throw AppError.conflict(`Brand "${input.name}" already exists`);
    return this.repo.create(input);
  }

  async update(id: string, input: UpdateBrandInput) {
    const existing = await this.repo.getById(id);
    if (!existing) throw AppError.notFound("Brand not found");
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await this.repo.checkDuplicate(input.name, id);
      if (dup) throw AppError.conflict(`Brand "${input.name}" already exists`);
    }
    return this.repo.update(id, input);
  }

  async getById(id: string) {
    const brand = await this.repo.getById(id);
    if (!brand) throw AppError.notFound("Brand not found");
    return brand;
  }

  async list(query: ListBrandsQuery) {
    return this.repo.list({ page: query.page, limit: query.limit, search: query.search });
  }

  async listAll() {
    return this.repo.listAll();
  }
}
