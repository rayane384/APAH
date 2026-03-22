import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

// GET /api/cron/resolve-tickets
// Finds all IN_PROGRESS reservation tickets whose endAt (or recurrenceEndDate) has passed
// and automatically switches them to RESOLVED.
export async function GET() {
  try {
    const now = new Date();

    const passedTickets = await prisma.ticket.findMany({
      where: {
        status: "IN_PROGRESS",
        category: { isReservation: true },
        reservationRequest: {
          status: { in: ["ACCEPTED", "OVERRIDDEN"] },
          approvedReservation: {
            OR: [
              { isRecurring: false, endAt: { lte: now } },
              { isRecurring: true, recurrenceEndDate: { lte: now } }
            ]
          }
        }
      },
      select: {
        id: true,
        assignedToId: true,
        createdById: true
      }
    });

    if (passedTickets.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    const ids = passedTickets.map((t: any) => t.id);

    await prisma.$transaction(async (tx: any) => {
      // 1. Update ticket statuses
      await tx.ticket.updateMany({
        where: { id: { in: ids } },
        data: { status: "RESOLVED" }
      });

      // 2. Insert history for each
      // Since TicketHistory requires a valid performedById (User relation),
      // we credit the automated resolution to the assigned staff or the creator.
      const historyData = passedTickets.map((t: any) => ({
        ticketId: t.id,
        action: "STATUS_CHANGED" as const,
        performedById: t.assignedToId || t.createdById,
        oldStatus: "IN_PROGRESS",
        newStatus: "RESOLVED"
      }));

      await tx.ticketHistory.createMany({
        data: historyData
      });
    });

    return NextResponse.json({ processed: ids.length, ids });
  } catch (error: any) {
    console.error("[CRON resolve-tickets] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
