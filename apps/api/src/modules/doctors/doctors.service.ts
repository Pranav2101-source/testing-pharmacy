import type { FastifyInstance } from "fastify";
import { DoctorsRepo } from "./doctors.repo.js";
import { AppError } from "../../lib/AppError.js";
import type { CreateDoctorInput, UpdateDoctorInput, ListDoctorsQuery } from "./doctors.schema.js";

export class DoctorsService {
  private repo: DoctorsRepo;

  constructor(app: FastifyInstance) {
    this.repo = new DoctorsRepo(app.prisma);
  }

  async list(pharmacyId: string, query: ListDoctorsQuery) {
    const [doctors, total] = await this.repo.list(pharmacyId, query);
    return {
      data:  doctors,
      total,
      page:  query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    };
  }

  async getById(id: string, pharmacyId: string) {
    const doctor = await this.repo.findById(id, pharmacyId);
    if (!doctor) throw new AppError("Doctor not found", 404);
    return doctor;
  }

  async create(pharmacyId: string, data: CreateDoctorInput) {
    return this.repo.create(pharmacyId, data);
  }

  async update(id: string, pharmacyId: string, data: UpdateDoctorInput) {
    await this.getById(id, pharmacyId);
    return this.repo.update(id, pharmacyId, data);
  }

  async deactivate(id: string, pharmacyId: string) {
    await this.getById(id, pharmacyId);
    return this.repo.setActive(id, pharmacyId, false);
  }

  async reactivate(id: string, pharmacyId: string) {
    await this.getById(id, pharmacyId);
    return this.repo.setActive(id, pharmacyId, true);
  }
}
