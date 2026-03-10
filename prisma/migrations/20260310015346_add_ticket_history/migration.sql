-- CreateEnum
CREATE TYPE "TicketHistoryAction" AS ENUM ('PICKED', 'UNPICKED', 'ROUTED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "TicketHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "action" "TicketHistoryAction" NOT NULL,
    "performedById" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "fromDepartmentId" TEXT,
    "toDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketHistory_ticketId_idx" ON "TicketHistory"("ticketId");

-- CreateIndex
CREATE INDEX "TicketHistory_performedById_idx" ON "TicketHistory"("performedById");

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
