import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../lib/auth-helpers";

/**
 * POST /api/reservations/manual
 * Admin-only: create a reservation directly without a ticket.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Only admins can create manual reservations." }, { status: 403 });
  }

  const body = await request.json();
  const { roomId, startAt, endAt, description } = body as {
    roomId: string;
    startAt: string;
    endAt: string;
    description?: string;
  };

  if (!roomId || !startAt || !endAt) {
    return NextResponse.json(
      { error: "roomId, startAt, and endAt are required." },
      { status: 400 }
    );
  }

  const start = new Date(startAt);
  const end = new Date(endAt);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid startAt or endAt date." }, { status: 400 });
  }
  if (start >= end) {
    return NextResponse.json({ error: "startAt must be before endAt." }, { status: 400 });
  }

  // Validate room exists and get its campus
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, campusId: true, name: true },
  });
  if (!room) {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }

  // Check for conflicting approved reservations
  const conflict = await prisma.reservation.findFirst({
    where: {
      roomId: room.id,
      status: "APPROVED",
      startAt: { lt: end },
      endAt: { gt: start },
    },
  });
  if (conflict) {
    return NextResponse.json(
      { error: "This slot already has an approved reservation." },
      { status: 409 }
    );
  }

  const reservation = await prisma.reservation.create({
    data: {
      kind: "MANUAL",
      status: "APPROVED",
      roomId: room.id,
      campusId: room.campusId,
      startAt: start,
      endAt: end,
      description: description?.trim() || `Manual reservation by ${user.name ?? "Admin"}`,
      createdById: user.id,
    },
    include: {
      room: { include: { campus: true, roomType: true } },
      campus: true,
    },
  });

  return NextResponse.json(reservation, { status: 201 });
}
