import type { FastifyInstance } from "fastify"
import { AppError } from "../../lib/AppError.js"
import { LocationsRepo } from "./locations.repo.js"
import type {
  CreateRackInput,
  CreateShelfInput,
  ListRacksQuery,
  UpdateRackInput,
  UpdateShelfInput,
} from "./locations.schema.js"

export class LocationsService {
  private repo: LocationsRepo

  constructor(app: FastifyInstance) {
    this.repo = new LocationsRepo(app.prisma)
  }

  async createRack(pharmacyId: string, input: CreateRackInput) {
    return this.repo.createRack(pharmacyId, input)
  }

  async updateRack(id: string, pharmacyId: string, input: UpdateRackInput) {
    const rack = await this.repo.getRack(id, pharmacyId)
    if (!rack) throw AppError.notFound("Rack not found")
    return this.repo.updateRack(id, pharmacyId, input)
  }

  async getRack(id: string, pharmacyId: string) {
    const rack = await this.repo.getRack(id, pharmacyId)
    if (!rack) throw AppError.notFound("Rack not found")
    return rack
  }

  async listRacks(pharmacyId: string, query: ListRacksQuery) {
    return this.repo.listRacks(pharmacyId, query)
  }

  async createShelf(pharmacyId: string, input: CreateShelfInput) {
    return this.repo.createShelf(pharmacyId, input)
  }

  async updateShelf(id: string, pharmacyId: string, input: UpdateShelfInput) {
    const shelf = await this.repo.updateShelf(id, pharmacyId, input).catch(() => null)
    if (!shelf) throw AppError.notFound("Shelf not found")
    return shelf
  }

  async listShelves(pharmacyId: string, query: ListRacksQuery) {
    return this.repo.listShelves(pharmacyId, query)
  }

  async getShelfDropdown(pharmacyId: string) {
    return this.repo.getShelfDropdown(pharmacyId)
  }
}
