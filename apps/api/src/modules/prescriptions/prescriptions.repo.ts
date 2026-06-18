import type { Db, Prisma } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import type { CreatePrescriptionInput, UpdatePrescriptionInput, ListPrescriptionsQuery } from "./prescriptions.schema.js";

const PRESCRIPTION_INCLUDE = {
  items:   true,
  doctor:  { select: { id: true, name: true, registrationNo: true } },
  upload:  { select: { id: true, fileUrl: true, fileName: true, mimeType: true } },
  invoices: { select: { id: true, invoiceNumber: true, createdAt: true } },
} satisfies Prisma.PrescriptionInclude;

export class PrescriptionsRepo {
  constructor(private db: Db) {}

  async create(pharmacyId: string, prescriptionNumber: string, data: CreatePrescriptionInput) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      return tx.prescription.create({
        data: {
          pharmacyId,
          prescriptionNumber,
          doctorId:      data.doctorId   ?? null,
          uploadId:      data.uploadId   ?? null,
          doctorName:    data.doctorName,
          doctorRegNo:   data.doctorRegNo,
          doctorPhone:   data.doctorPhone,
          patientName:   data.patientName,
          patientAge:    data.patientAge,
          patientPhone:  data.patientPhone,
          patientGender: data.patientGender,
          prescribedDate: data.prescribedDate ? new Date(data.prescribedDate) : null,
          validUntil:    data.validUntil ? new Date(data.validUntil) : null,
          notes:         data.notes,
          items: { create: data.items.map((item) => ({ ...item, pharmacyId })) },
        },
        include: PRESCRIPTION_INCLUDE,
      });
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.prescription.findFirst({
      where:   { id, pharmacyId },
      include: PRESCRIPTION_INCLUDE,
    });
  }

  async list(pharmacyId: string, params: ListPrescriptionsQuery) {
    const where: Prisma.PrescriptionWhereInput = {
      pharmacyId,
      ...(params.status   ? { status: params.status as any } : {}),
      ...(params.doctorId ? { doctorId: params.doctorId }    : {}),
      ...(params.from || params.to
        ? { createdAt: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to   ? { lte: new Date(params.to)   } : {}),
          }}
        : {}),
      ...(params.search
        ? { OR: [
            { patientName:        { contains: params.search, mode: "insensitive" } },
            { doctorName:         { contains: params.search, mode: "insensitive" } },
            { prescriptionNumber: { contains: params.search, mode: "insensitive" } },
          ]}
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.prescription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          items:  true,
          doctor: { select: { id: true, name: true } },
          upload: { select: { id: true, fileUrl: true, fileName: true, mimeType: true } },
        },
      }),
      this.db.prescription.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  async update(id: string, pharmacyId: string, data: UpdatePrescriptionInput) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      if (data.items) {
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id, pharmacyId } });
      }
      return tx.prescription.update({
        where: { id },
        data: {
          ...(data.doctorId       !== undefined ? { doctorId:       data.doctorId ?? null }               : {}),
          ...(data.doctorName     !== undefined ? { doctorName:     data.doctorName }                     : {}),
          ...(data.doctorRegNo    !== undefined ? { doctorRegNo:    data.doctorRegNo }                    : {}),
          ...(data.patientName    !== undefined ? { patientName:    data.patientName }                    : {}),
          ...(data.patientAge     !== undefined ? { patientAge:     data.patientAge }                     : {}),
          ...(data.patientPhone   !== undefined ? { patientPhone:   data.patientPhone }                   : {}),
          ...(data.patientGender  !== undefined ? { patientGender:  data.patientGender }                  : {}),
          ...(data.prescribedDate !== undefined ? { prescribedDate: data.prescribedDate ? new Date(data.prescribedDate) : null } : {}),
          ...(data.validUntil     !== undefined ? { validUntil:     data.validUntil ? new Date(data.validUntil) : null }         : {}),
          ...(data.notes          !== undefined ? { notes:          data.notes }                          : {}),
          ...(data.items ? { items: { create: data.items.map((item) => ({ ...item, pharmacyId })) } } : {}),
        },
        include: PRESCRIPTION_INCLUDE,
      });
    });
  }

  async cancel(id: string, pharmacyId: string) {
    const existing = await this.db.prescription.findFirst({
      where:  { id, pharmacyId },
      select: { status: true },
    });
    if (!existing) throw AppError.notFound("Prescription not found");
    if (existing.status === "DISPENSED") {
      throw AppError.unprocessable("Cannot cancel a dispensed prescription");
    }

    return this.db.prescription.update({
      where:   { id },
      data:    { status: "CANCELLED" },
      include: PRESCRIPTION_INCLUDE,
    });
  }
}
