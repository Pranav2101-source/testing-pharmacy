-- ─── Support Module Migration ─────────────────────────────────────────────────

-- AlterEnum: add platform roles
ALTER TYPE "Role" ADD VALUE 'SUPPORT_AGENT';
ALTER TYPE "Role" ADD VALUE 'PLATFORM_ADMIN';

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketLanguage" AS ENUM ('HINDI', 'ENGLISH');

-- CreateEnum
CREATE TYPE "AttachmentFileType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateTable: ticket_categories
CREATE TABLE "ticket_categories" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ticket_categories_name_key" ON "ticket_categories"("name");

-- CreateTable: support_agents
CREATE TABLE "support_agents" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "lastAssignedAt" TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_agents_userId_key" ON "support_agents"("userId");

-- CreateTable: support_tickets
CREATE TABLE "support_tickets" (
    "id"              TEXT NOT NULL,
    "ticketNumber"    TEXT NOT NULL,
    "pharmacyId"      TEXT NOT NULL,
    "raisedById"      TEXT NOT NULL,
    "categoryId"      TEXT NOT NULL,
    "customTitle"     TEXT,
    "assignedAgentId" TEXT,
    "status"          "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "language"        "TicketLanguage" NOT NULL DEFAULT 'ENGLISH',
    "description"     TEXT NOT NULL,
    "mobile"          TEXT NOT NULL,
    "altMobile"       TEXT,
    "resolvedAt"      TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_tickets_ticketNumber_key" ON "support_tickets"("ticketNumber");
CREATE INDEX "support_tickets_pharmacyId_status_idx" ON "support_tickets"("pharmacyId", "status");
CREATE INDEX "support_tickets_pharmacyId_createdAt_idx" ON "support_tickets"("pharmacyId", "createdAt" DESC);
CREATE INDEX "support_tickets_assignedAgentId_status_idx" ON "support_tickets"("assignedAgentId", "status");

-- CreateTable: ticket_messages
CREATE TABLE "ticket_messages" (
    "id"        TEXT NOT NULL,
    "ticketId"  TEXT NOT NULL,
    "senderId"  TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- CreateTable: ticket_attachments
CREATE TABLE "ticket_attachments" (
    "id"        TEXT NOT NULL,
    "ticketId"  TEXT NOT NULL,
    "messageId" TEXT,
    "fileName"  TEXT NOT NULL,
    "fileUrl"   TEXT NOT NULL,
    "fileSize"  INTEGER NOT NULL,
    "mimeType"  TEXT NOT NULL,
    "fileType"  "AttachmentFileType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_attachments_ticketId_idx" ON "ticket_attachments"("ticketId");

-- AddForeignKey
ALTER TABLE "support_agents"
    ADD CONSTRAINT "support_agents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_pharmacyId_fkey"
    FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_raisedById_fkey"
    FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_assignedAgentId_fkey"
    FOREIGN KEY ("assignedAgentId") REFERENCES "support_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages"
    ADD CONSTRAINT "ticket_messages_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_messages"
    ADD CONSTRAINT "ticket_messages_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments"
    ADD CONSTRAINT "ticket_attachments_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_attachments"
    ADD CONSTRAINT "ticket_attachments_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "ticket_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Platform Pharmacy (home for support staff) ───────────────────────────────
INSERT INTO "pharmacies" ("id", "name", "slug", "isActive", "createdAt", "updatedAt")
VALUES ('platform_checkup_support', 'Checkup Support Team', 'platform-support', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- ─── Pre-seeded ticket categories ────────────────────────────────────────────
INSERT INTO "ticket_categories" ("id", "name", "isActive", "sortOrder", "createdAt") VALUES
  ('cat_billing',      'Billing & Payments',   true, 1, NOW()),
  ('cat_inventory',    'Inventory & Stock',     true, 2, NOW()),
  ('cat_medicine',     'Medicine Search',       true, 3, NOW()),
  ('cat_reports',      'Reports',               true, 4, NOW()),
  ('cat_technical',    'Technical Issue',       true, 5, NOW()),
  ('cat_account',      'Account & Access',      true, 6, NOW()),
  ('cat_other',        'Other',                 true, 7, NOW())
ON CONFLICT ("name") DO NOTHING;
