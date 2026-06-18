import type { FastifyInstance } from "fastify";
import { PrescriptionsRepo } from "./prescriptions.repo.js";
import type { CreatePrescriptionInput, UpdatePrescriptionInput, ListPrescriptionsQuery } from "./prescriptions.schema.js";
import { AppError } from "../../lib/AppError.js";

export class PrescriptionsService {
  private repo: PrescriptionsRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new PrescriptionsRepo(app.prisma);
  }

  private async nextNumber(pharmacyId: string): Promise<string> {
    const count = await this.app.prisma.prescription.count({ where: { pharmacyId } });
    return `RX-${String(count + 1).padStart(5, "0")}`;
  }

  async create(pharmacyId: string, data: CreatePrescriptionInput) {
    if (data.doctorId) {
      const doctor = await this.app.prisma.doctor.findFirst({
        where:  { id: data.doctorId, pharmacyId, isActive: true },
        select: { id: true },
      });
      if (!doctor) throw AppError.notFound("Doctor not found or inactive");
    }
    if (data.uploadId) {
      const upload = await this.app.prisma.upload.findFirst({
        where:  { id: data.uploadId, pharmacyId },
        select: { id: true },
      });
      if (!upload) throw AppError.notFound("Upload not found");
    }
    const number = await this.nextNumber(pharmacyId);
    return this.repo.create(pharmacyId, number, data);
  }

  async getById(id: string, pharmacyId: string) {
    const rx = await this.repo.getById(id, pharmacyId);
    if (!rx) throw AppError.notFound("Prescription not found");
    return rx;
  }

  async list(pharmacyId: string, query: ListPrescriptionsQuery) {
    return this.repo.list(pharmacyId, query);
  }

  async update(id: string, pharmacyId: string, data: UpdatePrescriptionInput) {
    const rx = await this.repo.getById(id, pharmacyId);
    if (!rx) throw AppError.notFound("Prescription not found");
    if (rx.status === "CANCELLED") throw AppError.unprocessable("Cannot update a cancelled prescription");
    if (rx.status === "DISPENSED") throw AppError.unprocessable("Cannot update a dispensed prescription");
    return this.repo.update(id, pharmacyId, data);
  }

  async cancel(id: string, pharmacyId: string) {
    return this.repo.cancel(id, pharmacyId);
  }
}
