-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "routedToId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_routedToId_key" ON "Ticket"("routedToId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_routedToId_fkey" FOREIGN KEY ("routedToId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
