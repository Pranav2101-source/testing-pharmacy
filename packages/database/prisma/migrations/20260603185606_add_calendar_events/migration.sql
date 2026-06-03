-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('EXPIRY_ALERT', 'CREDIT_DUE', 'PO_DELIVERY', 'BILL_REMINDER', 'STOCK_AUDIT', 'LICENSE_RENEWAL', 'CUSTOM');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "type" "CalendarEventType" NOT NULL DEFAULT 'CUSTOM',
    "color" TEXT,
    "relatedId" TEXT,
    "relatedType" TEXT,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_pharmacyId_date_idx" ON "calendar_events"("pharmacyId", "date");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
