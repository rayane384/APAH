-- AlterTable
ALTER TABLE "ReservationRequest" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurrenceEndDate" TIMESTAMP(3);
