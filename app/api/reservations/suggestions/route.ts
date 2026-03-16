import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/auth-helpers";

/**
 * GET /api/reservations/suggestions?date=YYYY-MM-DD&campusId=&roomTypeId=&period=&durationMin=&startHour=
 *
 * Generates available time-slot suggestions for room reservations.
 * Slots blocked by an APPROVED Reservation are excluded.
 * Pending request count is computed from ReservationRequest whose ticket is NEW or IN_PROGRESS.
 * Sorted by lowest historical demand first.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const dateStr = searchParams.get("date");
  if (!dateStr) {
    return NextResponse.json({ error: "date query parameter is required (YYYY-MM-DD)." }, { status: 400 });
  }

  // Parse date in UTC
  const dateParts = dateStr.split("-").map(Number);
  if (dateParts.length !== 3 || dateParts.some(isNaN)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }
  const [year, month, day] = dateParts;
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  // Optional filters
  const campusId = searchParams.get("campusId") || undefined;
  const roomTypeId = searchParams.get("roomTypeId") || undefined;
  const period = searchParams.get("period") || undefined; // BEFORE_MIDDAY | AFTER_MIDDAY
  const durationMinParam = searchParams.get("durationMin");
  const startHourParam = searchParams.get("startHour");

  const slotDuration = durationMinParam ? Math.max(60, Math.min(120, parseInt(durationMinParam, 10))) : 120;
  const filterStartHour = startHourParam ? parseInt(startHourParam, 10) : undefined;

  // 1. Fetch rooms with optional filters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomWhere: any = {};
  if (campusId) roomWhere.campusId = campusId;
  if (roomTypeId) roomWhere.roomTypeId = roomTypeId;

  const rooms = await prisma.room.findMany({
    where: roomWhere,
    include: {
      campus: { select: { id: true, name: true, code: true } },
      roomType: { select: { id: true, name: true, code: true } },
    },
  });

  if (rooms.length === 0) {
    return NextResponse.json([]);
  }

  // 2. Fetch approved reservations for that day across all relevant rooms
  const roomIds = rooms.map((r) => r.id);

  const approvedReservations = await prisma.reservation.findMany({
    where: {
      roomId: { in: roomIds },
      status: "APPROVED",
      startAt: { lte: dayEnd },
      endAt: { gte: dayStart },
    },
    select: { roomId: true, startAt: true, endAt: true },
  });

  // 3. Fetch pending reservation requests (ticket status NEW or IN_PROGRESS)
  const pendingRequests = await prisma.reservationRequest.findMany({
    where: {
      roomId: { in: roomIds },
      startAt: { lte: dayEnd },
      endAt: { gte: dayStart },
      ticket: {
        status: { in: ["NEW", "IN_PROGRESS"] },
      },
    },
    select: { roomId: true, startAt: true, endAt: true },
  });

  // 4. Fetch historical demand data
  const slotDemands = await prisma.roomSlotDemand.findMany({
    where: { roomId: { in: roomIds } },
    select: { roomId: true, slotStartMinute: true, durationMinutes: true, requestCount: true },
  });

  // Build demand lookup: roomId -> slotStartMinute -> requestCount
  const demandMap = new Map<string, Map<number, number>>();
  for (const sd of slotDemands) {
    if (!demandMap.has(sd.roomId)) demandMap.set(sd.roomId, new Map());
    demandMap.get(sd.roomId)!.set(sd.slotStartMinute, sd.requestCount);
  }

  // 5. Generate slots
  const SLOT_START_HOUR = 8;  // 08:00 UTC
  const SLOT_END_HOUR = 18;   // 18:00 UTC
  const slotDurationMs = slotDuration * 60 * 1000;

  type Suggestion = {
    roomId: string;
    roomName: string;
    roomCode: string;
    campusId: string;
    campusName: string;
    campusCode: string;
    roomTypeName: string | null;
    roomTypeCode: string | null;
    startAt: string;
    endAt: string;
    pendingCount: number;
    historicalDemand: number;
  };

  const suggestions: Suggestion[] = [];

  for (const room of rooms) {
    // Generate time slots for the day
    for (let hour = SLOT_START_HOUR; hour + (slotDuration / 60) <= SLOT_END_HOUR; hour++) {
      // For 2h slots: 8,10,12,14,16. For 1h: every hour
      if (slotDuration === 120 && hour % 2 !== 0) continue;

      const slotStart = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
      const slotEnd = new Date(slotStart.getTime() + slotDurationMs);

      // Apply period filter
      if (period === "BEFORE_MIDDAY" && hour >= 12) continue;
      if (period === "AFTER_MIDDAY" && hour < 12) continue;

      // Apply start hour filter
      if (filterStartHour !== undefined && hour !== filterStartHour) continue;

      // Check if blocked by an approved reservation
      const isBlocked = approvedReservations.some(
        (r) =>
          r.roomId === room.id &&
          r.startAt < slotEnd &&
          r.endAt > slotStart
      );
      if (isBlocked) continue;

      // Count pending requests that overlap this slot
      const pendingCount = pendingRequests.filter(
        (r) =>
          r.roomId === room.id &&
          r.startAt < slotEnd &&
          r.endAt > slotStart
      ).length;

      // Historical demand
      const slotStartMinute = hour * 60;
      const historicalDemand = demandMap.get(room.id)?.get(slotStartMinute) ?? 0;

      suggestions.push({
        roomId: room.id,
        roomName: room.name,
        roomCode: room.code,
        campusId: room.campus.id,
        campusName: room.campus.name,
        campusCode: room.campus.code,
        roomTypeName: room.roomType?.name ?? null,
        roomTypeCode: room.roomType?.code ?? null,
        startAt: slotStart.toISOString(),
        endAt: slotEnd.toISOString(),
        pendingCount,
        historicalDemand,
      });
    }
  }

  // 6. Sort by lowest historical demand first
  suggestions.sort((a, b) => a.historicalDemand - b.historicalDemand);

  return NextResponse.json(suggestions);
}
