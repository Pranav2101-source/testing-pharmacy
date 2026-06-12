import type { Db } from "@pharmacy/database"
import { AppError } from "../../lib/AppError.js"
import type {
  CreateRackInput,
  CreateShelfInput,
  ListRacksQuery,
  UpdateRackInput,
  UpdateShelfInput,
} from "./locations.schema.js"

const SHELF_INCLUDE = {
  rack: { select: { id: true, code: true, name: true } },
} as const

export class LocationsRepo {
  constructor(private db: Db) {}

  // ── Racks ──────────────────────────────────────────────────────────────────

  async createRack(pharmacyId: string, data: CreateRackInput) {
    const existing = await this.db.rack.findUnique({
      where: { pharmacyId_code: { pharmacyId, code: data.code } },
    })
    if (existing) throw AppError.conflict(`Rack code "${data.code}" already exists`)

    return this.db.rack.create({
      data: { pharmacyId, ...data },
      include: { shelves: true },
    })
  }

  async updateRack(id: string, pharmacyId: string, data: UpdateRackInput) {
    if (data.code) {
      const conflict = await this.db.rack.findFirst({
        where: { pharmacyId, code: data.code, NOT: { id } },
      })
      if (conflict) throw AppError.conflict(`Rack code "${data.code}" already exists`)
    }
    return this.db.rack.update({
      where: { id, pharmacyId },
      data,
      include: { shelves: true },
    })
  }

  async getRack(id: string, pharmacyId: string) {
    return this.db.rack.findFirst({
      where: { id, pharmacyId },
      include: {
        shelves: {
          orderBy: [{ level: "asc" }, { code: "asc" }],
        },
      },
    })
  }

  async listRacks(pharmacyId: string, params: ListRacksQuery) {
    const where = {
      pharmacyId,
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.search
        ? {
            OR: [
              { code: { contains: params.search, mode: "insensitive" as const } },
              { name: { contains: params.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.db.rack.findMany({
        where,
        include: { shelves: { where: { isActive: true }, select: { id: true } } },
        orderBy: { code: "asc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.db.rack.count({ where }),
    ])

    return { items, total, page: params.page, limit: params.limit }
  }

  // ── Shelves ─────────────────────────────────────────────────────────────────

  async createShelf(pharmacyId: string, data: CreateShelfInput) {
    const rack = await this.db.rack.findFirst({ where: { id: data.rackId, pharmacyId } })
    if (!rack) throw AppError.notFound("Rack not found")

    const existing = await this.db.shelf.findUnique({
      where: { pharmacyId_code: { pharmacyId, code: data.code } },
    })
    if (existing) throw AppError.conflict(`Shelf code "${data.code}" already exists`)

    return this.db.shelf.create({
      data: { pharmacyId, ...data },
      include: SHELF_INCLUDE,
    })
  }

  async updateShelf(id: string, pharmacyId: string, data: UpdateShelfInput) {
    if (data.code) {
      const conflict = await this.db.shelf.findFirst({
        where: { pharmacyId, code: data.code, NOT: { id } },
      })
      if (conflict) throw AppError.conflict(`Shelf code "${data.code}" already exists`)
    }
    return this.db.shelf.update({
      where: { id, pharmacyId },
      data,
      include: SHELF_INCLUDE,
    })
  }

  async listShelves(pharmacyId: string, params: ListRacksQuery) {
    const where = {
      pharmacyId,
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.search
        ? {
            OR: [
              { code: { contains: params.search, mode: "insensitive" as const } },
              { rack: { name: { contains: params.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      this.db.shelf.findMany({
        where,
        include: SHELF_INCLUDE,
        orderBy: [{ rack: { code: "asc" } }, { level: "asc" }, { code: "asc" }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.db.shelf.count({ where }),
    ])

    return { items, total, page: params.page, limit: params.limit }
  }

  async getShelfDropdown(pharmacyId: string) {
    return this.db.shelf.findMany({
      where: { pharmacyId, isActive: true },
      include: SHELF_INCLUDE,
      orderBy: [{ rack: { code: "asc" } }, { level: "asc" }, { code: "asc" }],
    })
  }
}
