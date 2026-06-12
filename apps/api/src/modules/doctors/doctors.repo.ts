import type { Db } from "@pharmacy/database";
import type { CreateDoctorInput, UpdateDoctorInput, ListDoctorsQuery } from "./doctors.schema.js";

export class DoctorsRepo {
  constructor(private db: Db) {}

  list(pharmacyId: string, query: ListDoctorsQuery) {
    const { search, isActive, page, limit } = query;
    const skip = (page - 1) * limit;

    const where = {
      pharmacyId,
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name:           { contains: search, mode: "insensitive" as const } },
              { specialty:      { contains: search, mode: "insensitive" as const } },
              { registrationNo: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    return Promise.all([
      this.db.doctor.findMany({ where, orderBy: { name: "asc" }, skip, take: limit }),
      this.db.doctor.count({ where }),
    ]);
  }

  findById(id: string, pharmacyId: string) {
    return this.db.doctor.findFirst({ where: { id, pharmacyId } });
  }

  create(pharmacyId: string, data: CreateDoctorInput) {
    return this.db.doctor.create({
      data: { ...data, pharmacyId, email: data.email || undefined },
    });
  }

  update(id: string, pharmacyId: string, data: UpdateDoctorInput) {
    return this.db.doctor.update({
      where: { id },
      data:  { ...data, pharmacyId, email: data.email || undefined },
    });
  }

  setActive(id: string, pharmacyId: string, isActive: boolean) {
    return this.db.doctor.update({ where: { id }, data: { isActive } });
  }
}
