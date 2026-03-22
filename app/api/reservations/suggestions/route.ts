import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/auth-helpers";

const SESSION_WINDOWS = [
  { startMinute: 8 * 60 + 30, endMinute: 10 * 60 + 30 },
  { startMinute: 10 * 60 + 30, endMinute: 12 * 60 + 30 },
  { startMinute: 12 * 60 + 30, endMinute: 14 * 60 + 30 },
  { startMinute: 14 * 60 + 30, endMinute: 16 * 60 + 30 },
  { startMinute: 16 * 60 + 30, endMinute: 18 * 60 + 30 },
];

const DAY_START_MINUTE = SESSION_WINDOWS[0].startMinute;
const DAY_END_MINUTE = SESSION_WINDOWS[SESSION_WINDOWS.length - 1].endMinute;

function overlapsVisibleSessions(startMinute: number, endMinute: number) {
  return SESSION_WINDOWS.some((window) => startMinute < window.endMinute && endMinute > window.startMinute);
}

function normalizeDuration(raw: string | null) {
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (parsed === 60 || parsed === 75 || parsed === 90 || parsed === 105 || parsed === 120) return parsed;
  return 120;
}

function parseStartTimeFilter(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function toMinuteOfDay(date: Date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function toUtcMidnightMs(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isWeeklyDateAligned(base: Date, candidate: Date) {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((toUtcMidnightMs(candidate) - toUtcMidnightMs(base)) / ONE_DAY_MS);
  return diffDays >= 0 && diffDays % 7 === 0;
}

type ApprovedReservationForSuggestion = {
  id: string;
  kind: "MANUAL" | "STANDARD_SCHEDULE";
  roomId: string;
  startAt: Date;
  endAt: Date;
  isRecurring: boolean;
  recurrenceEndDate: Date | null;
  approvedByRequest: { ticketId: string } | null;
  createdFromRequest: { ticketId: string } | null;
};

function reservationBlocksSlot(
  reservation: ApprovedReservationForSuggestion,
  slotStart: Date,
  slotEnd: Date
) {
  if (!reservation.isRecurring) {
    return reservation.startAt < slotEnd && reservation.endAt > slotStart;
  }

  const reservationStart = reservation.startAt;
  const reservationDay = reservationStart.getUTCDay() || 7;
  const slotDay = slotStart.getUTCDay() || 7;
  if (reservationDay !== slotDay) return false;

  if (slotStart < reservationStart) return false;
  if (reservation.recurrenceEndDate && slotStart > reservation.recurrenceEndDate) return false;
  if (!isWeeklyDateAligned(reservationStart, slotStart)) return false;

  const reservationStartMinute = toMinuteOfDay(reservation.startAt);
  const reservationEndMinute = toMinuteOfDay(reservation.endAt);
  const slotStartMinute = toMinuteOfDay(slotStart);
  const slotEndMinute = toMinuteOfDay(slotEnd);

  return slotStartMinute < reservationEndMinute && slotEndMinute > reservationStartMinute;
}

/**
 * GET /api/reservations/suggestions?date=YYYY-MM-DD&campusId=&roomTypeId=&period=&durationMin=&startHour=&startTime=
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

  const dateParts = dateStr.split("-").map(Number);
  if (dateParts.length !== 3 || dateParts.some(isNaN)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }
  const [year, month, day] = dateParts;
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  const campusId = searchParams.get("campusId") || undefined;
  const roomTypeId = searchParams.get("roomTypeId") || undefined;
  const period = searchParams.get("period") || undefined;
  const durationMinParam = searchParams.get("durationMin");
  const startHourParam = searchParams.get("startHour");
  const startTimeParam = searchParams.get("startTime");
  const includeTaken = searchParams.get("includeTaken") === "true";

  const slotDuration = normalizeDuration(durationMinParam);
  const filterStartHour = startHourParam ? parseInt(startHourParam, 10) : undefined;
  const filterStartMinute = parseStartTimeFilter(startTimeParam);

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

  if (rooms.length === 0) return NextResponse.json([]);

  const roomIds = rooms.map((r) => r.id);

  const approvedReservations = await prisma.reservation.findMany({
    where: {
      roomId: { in: roomIds },
      status: "APPROVED",
      OR: [
        {
          isRecurring: false,
          startAt: { lte: dayEnd },
          endAt: { gte: dayStart },
        },
        {
          isRecurring: true,
          startAt: { lte: dayEnd },
          OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: dayStart } }],
        },
      ],
    },
    select: {
      id: true,
      kind: true,
      roomId: true,
      startAt: true,
      endAt: true,
      isRecurring: true,
      recurrenceEndDate: true,
      approvedByRequest: { select: { ticketId: true } },
      createdFromRequest: { select: { ticketId: true } },
    },
  });

  const pendingRequests = await prisma.reservationRequest.findMany({
    where: {
      roomId: { in: roomIds },
      startAt: { lte: dayEnd },
      endAt: { gte: dayStart },
      ticket: { status: { in: ["NEW", "IN_PROGRESS"] } },
    },
    select: { roomId: true, startAt: true, endAt: true },
  });

  const slotDemands = await prisma.roomSlotDemand.findMany({
    where: { roomId: { in: roomIds } },
    select: { roomId: true, slotStartMinute: true, requestCount: true },
  });

  const demandMap = new Map<string, Map<number, number>>();
  for (const sd of slotDemands) {
    if (!demandMap.has(sd.roomId)) demandMap.set(sd.roomId, new Map());
    demandMap.get(sd.roomId)!.set(sd.slotStartMinute, sd.requestCount);
  }

  const slotDurationMs = slotDuration * 60 * 1000;
  const suggestions = [] as Array<{
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
    isTaken?: boolean;
    takenTicketId?: string;
    takenReservationId?: string;
    takenReservationKind?: "MANUAL" | "STANDARD_SCHEDULE";
  }>;

  for (const room of rooms) {
    for (let slotStartMinute = DAY_START_MINUTE; slotStartMinute + slotDuration <= DAY_END_MINUTE; slotStartMinute += 15) {
      const slotEndMinute = slotStartMinute + slotDuration;
      if (!overlapsVisibleSessions(slotStartMinute, slotEndMinute)) continue;

      const slotStartHour = Math.floor(slotStartMinute / 60);
      const slotStartMin = slotStartMinute % 60;
      const slotStart = new Date(Date.UTC(year, month - 1, day, slotStartHour, slotStartMin, 0));
      const slotEnd = new Date(slotStart.getTime() + slotDurationMs);

      if (period === "BEFORE_MIDDAY" && slotStartHour >= 12) continue;
      if (period === "AFTER_MIDDAY" && slotStartHour < 12) continue;
      if (filterStartMinute !== null && slotStartMinute !== filterStartMinute) continue;
      if (filterStartHour !== undefined && slotStartHour !== filterStartHour) continue;

      const blockingReservation = approvedReservations.find(
        (r) => r.roomId === room.id && reservationBlocksSlot(r, slotStart, slotEnd)
      );
      const isBlocked = !!blockingReservation;
      if (isBlocked && !includeTaken) continue;

      let isTaken = false;
      let takenTicketId: string | undefined;
      let takenReservationId: string | undefined;
      let takenReservationKind: "MANUAL" | "STANDARD_SCHEDULE" | undefined;
      if (isBlocked && blockingReservation) {
        isTaken = true;
        if (blockingReservation.approvedByRequest) takenTicketId = blockingReservation.approvedByRequest.ticketId;
        else if (blockingReservation.createdFromRequest) takenTicketId = blockingReservation.createdFromRequest.ticketId;
        takenReservationId = blockingReservation.id;
        takenReservationKind = blockingReservation.kind;
      }

      const pendingCount = pendingRequests.filter(
        (r) => r.roomId === room.id && r.startAt < slotEnd && r.endAt > slotStart
      ).length;

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
        isTaken,
        takenTicketId,
        takenReservationId,
        takenReservationKind,
      });
    }
  }

  suggestions.sort((a, b) => a.historicalDemand - b.historicalDemand);
  return NextResponse.json(suggestions);
}
