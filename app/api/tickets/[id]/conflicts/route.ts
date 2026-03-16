import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/tickets/[id]/conflicts
 * Returns conflicting reservation requests for a reservation ticket.
 * Two requests conflict if: same room, same date, overlapping time, and status PENDING.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Only admins can view conflicts." }, { status: 403 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      category: true,
      reservationRequest: true,
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (!ticket.category.isReservation || !ticket.reservationRequest) {
    return NextResponse.json({ error: "This ticket is not a reservation ticket." }, { status: 400 });
  }

  const rr = ticket.reservationRequest;

  // Find other reservation requests for the same room with overlapping times
  // that are still PENDING (i.e., their ticket is NEW or IN_PROGRESS)
  const conflicts = await prisma.reservationRequest.findMany({
    where: {
      id: { not: rr.id },
      roomId: rr.roomId,
      status: "PENDING",
      startAt: { lt: rr.endAt },
      endAt: { gt: rr.startAt },
    },
    include: {
      ticket: {
        select: {
          id: true,
          description: true,
          status: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
      },
      room: {
        include: {
          campus: { select: { id: true, name: true, code: true } },
          roomType: { select: { id: true, name: true, code: true } },
        },
      },
      campus: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    conflicts.map((c) => ({
      requestId: c.id,
      ticketId: c.ticket.id,
      description: c.ticket.description,
      ticketStatus: c.ticket.status,
      createdBy: c.ticket.createdBy,
      roomName: c.room.name,
      roomCode: c.room.code,
      campusName: c.campus.name,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
      adminCanAdjust: c.adminCanAdjust,
    }))
  );
}
