import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/rooms/[id]/timetable?weekStart=2026-03-16
 * Returns all reservations for a room within the given week (Mon-Sat).
 * For recurring reservations, generates virtual occurrences.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id: roomId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const weekStartParam = searchParams.get("weekStart");

  // Calculate Monday of the requested week (or current week)
  let weekStart: Date;
  if (weekStartParam) {
    weekStart = new Date(weekStartParam + "T00:00:00Z");
  } else {
    weekStart = new Date();
    weekStart.setUTCHours(0, 0, 0, 0);
  }
  // Adjust to Monday
  const dayOfWeek = weekStart.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setUTCDate(weekStart.getUTCDate() + diffToMonday);

  // Saturday end = weekStart + 6 days (end of Saturday)
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  // Verify room exists
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      campus: { select: { id: true, name: true, code: true } },
      roomType: { select: { id: true, name: true, code: true } },
    },
  });
  if (!room) {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }

  // 1) Get non-recurring reservations that fall within this week
  const directReservations = await prisma.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
      isRecurring: false,
      startAt: { gte: weekStart, lte: weekEnd },
    },
    include: {
      createdBy: { select: { id: true, fullName: true } },
    },
    orderBy: { startAt: "asc" },
  });

  // 2) Get recurring reservations that could have occurrences in this week
  const recurringReservations = await prisma.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
      isRecurring: true,
      startAt: { lte: weekEnd }, // started before or during this week
      OR: [
        { recurrenceEndDate: null },
        { recurrenceEndDate: { gte: weekStart } }, // hasn't ended before this week
      ],
    },
    include: {
      createdBy: { select: { id: true, fullName: true } },
    },
  });

  // Generate virtual occurrences for recurring reservations
  const recurringOccurrences = [];
  for (const res of recurringReservations) {
    const origStart = new Date(res.startAt);
    const origEnd = new Date(res.endAt);
    const durationMs = origEnd.getTime() - origStart.getTime();
    const origDayOfWeek = origStart.getUTCDay(); // 0-6

    // Find the date in this week that matches the original day of week
    for (let d = 0; d < 6; d++) {
      const candidate = new Date(weekStart);
      candidate.setUTCDate(candidate.getUTCDate() + d);
      if (candidate.getUTCDay() === origDayOfWeek) {
        // Check if this occurrence is within the recurrence window
        const occurrenceStart = new Date(Date.UTC(
          candidate.getUTCFullYear(),
          candidate.getUTCMonth(),
          candidate.getUTCDate(),
          origStart.getUTCHours(),
          origStart.getUTCMinutes(),
        ));
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);

        // Must be after the original start and before recurrence end
        if (occurrenceStart >= origStart && (!res.recurrenceEndDate || occurrenceStart <= res.recurrenceEndDate)) {
          recurringOccurrences.push({
            id: res.id,
            kind: res.kind,
            status: res.status,
            description: res.description,
            isRecurring: true,
            startAt: occurrenceStart.toISOString(),
            endAt: occurrenceEnd.toISOString(),
            createdBy: res.createdBy,
          });
        }
        break;
      }
    }
  }

  // Convert direct reservations to same shape
  const directMapped = directReservations.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    description: r.description,
    isRecurring: false,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    createdBy: r.createdBy,
  }));

  return NextResponse.json({
    room: {
      id: room.id,
      name: room.name,
      code: room.code,
      campus: room.campus,
      roomType: room.roomType,
    },
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    reservations: [...directMapped, ...recurringOccurrences].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    ),
  });
}
