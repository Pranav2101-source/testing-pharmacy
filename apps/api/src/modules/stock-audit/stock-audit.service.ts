import type { FastifyInstance } from "fastify"
import { AppError } from "../../lib/AppError.js"
import { StockAuditRepo } from "./stock-audit.repo.js"
import type {
  ApproveSessionInput,
  CompleteSessionInput,
  CreateSessionInput,
  ListSessionsQuery,
  UpdateItemInput,
} from "./stock-audit.schema.js"
import { generateAuditNumber } from "../billing/billing.constants.js"
import { nextSequenceValue, istDayPeriod } from "../../lib/sequences.js"

export class StockAuditService {
  private repo: StockAuditRepo

  constructor(private app: FastifyInstance) {
    this.repo = new StockAuditRepo(app.prisma)
  }

  async createSession(pharmacyId: string, userId: string, input: CreateSessionInput) {
    // Session number from the durable Postgres counter (per-IST-day period) so
    // the AUDIT-YYYYMMDD-NNN suffix stays small and never collides.
    const seq           = await nextSequenceValue(this.app.prisma, pharmacyId, "STOCK_AUDIT", istDayPeriod())
    const sessionNumber = generateAuditNumber(seq)
    return this.repo.createSession(pharmacyId, userId, sessionNumber, input)
  }

  async startSession(id: string, pharmacyId: string) {
    return this.repo.startSession(id, pharmacyId)
  }

  async updateItem(sessionId: string, itemId: string, pharmacyId: string, input: UpdateItemInput) {
    return this.repo.updateItem(sessionId, itemId, pharmacyId, input)
  }

  async completeSession(id: string, pharmacyId: string, userId: string, input: CompleteSessionInput) {
    return this.repo.completeSession(id, pharmacyId, userId, input)
  }

  async approveSession(id: string, pharmacyId: string, userId: string, input: ApproveSessionInput) {
    return this.repo.approveSession(id, pharmacyId, userId, input)
  }

  async cancelSession(id: string, pharmacyId: string, userId: string) {
    return this.repo.cancelSession(id, pharmacyId, userId)
  }

  async getSession(id: string, pharmacyId: string) {
    const session = await this.repo.getSession(id, pharmacyId)
    if (!session) throw AppError.notFound("Audit session not found")
    return session
  }

  async listSessions(pharmacyId: string, query: ListSessionsQuery) {
    return this.repo.listSessions(pharmacyId, query)
  }

  async getVarianceSummary(id: string, pharmacyId: string) {
    return this.repo.getVarianceSummary(id, pharmacyId)
  }
}
