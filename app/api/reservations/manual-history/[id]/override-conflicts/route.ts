import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getCurrentUser } from "../../../../../lib/auth-helpers";
import { isReservationDepartmentAdmin } from "../../../../../lib/reservation-admin";

type Params = { params: Promise<{ id: string }> };

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ReservationEntity = Awaited<ReturnType<typeof prisma.reservation.findUnique>>;

type ConflictItem = {
  reservationId: string;
  description: string;
  kind: string;
  status: string;
  isRecurring: boolean;
  conflictOccurrenceStart: string;
  conflictOccurrenceEnd: string;
  linkType: "ticket" | "manual";
  linkHref: string;
  linkLabel: string;
};

function toMinuteOfDay(date: Date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function toUtcMidnightMs(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isWeeklyDateAligned(base: Date, candidate: Date) {
  const diffDays = Math.floor((toUtcMidnightMs(candidate) - toUtcMidnightMs(base)) / ONE_DAY_MS);
  return diffDays >= 0 && diffDays % 7 === 0;
}

function dateOnlyUtc(input: string) {
  return new Date(`${input}T00:00:00.000Z`);
}

function addDaysUtc(date: Date, days: number) {
  return new Date(toUtcMidnightMs(date) + days * ONE_DAY_MS);
}

function buildOccurrenceForDate(reservation: NonNullable<ReservationEntity>, occurrenceDate: string) {
  const date = dateOnlyUtc(occurrenceDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const baseStart = reservation.startAt;
  const baseEnd = reservation.endAt;

  const occurrenceStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    baseStart.getUTCHours(),
    baseStart.getUTCMinutes(),
    baseStart.getUTCSeconds(),
    baseStart.getUTCMilliseconds(),
  ));
  const occurrenceEnd = new Date(occurrenceStart.getTime() + (baseEnd.getTime() - baseStart.getTime()));

  if ((occurrenceStart.getUTCDay() || 7) !== (baseStart.getUTCDay() || 7)) {
    return null;
  }

  if (occurrenceStart < baseStart) {
    return null;
  }

  if (reservation.recurrenceEndDate && occurrenceStart > reservation.recurrenceEndDate) {
    return null;
  }

  if (!isWeeklyDateAligned(baseStart, occurrenceStart)) {
    return null;
  }

  return { occurrenceStart, occurrenceEnd };
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function findFirstSeriesOccurrenceOnOrAfter(seriesStart: Date, threshold: Date) {
  const startMidnight = toUtcMidnightMs(seriesStart);
  const thresholdMidnight = toUtcMidnightMs(threshold);

  if (thresholdMidnight <= startMidnight) {
    return new Date(startMidnight);
  }

  const diffDays = Math.ceil((thresholdMidnight - startMidnight) / ONE_DAY_MS);
  const weeksToAdvance = Math.ceil(diffDays / 7);
  return addDaysUtc(seriesStart, weeksToAdvance * 7);
}

function buildOccurrenceOnDate(
  reservation: { startAt: Date; endAt: Date },
  date: Date
) {
  const occurrenceStart = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    reservation.startAt.getUTCHours(),
    reservation.startAt.getUTCMinutes(),
    reservation.startAt.getUTCSeconds(),
    reservation.startAt.getUTCMilliseconds(),
  ));
  const durationMs = reservation.endAt.getTime() - reservation.startAt.getTime();
  return {
    occurrenceStart,
    occurrenceEnd: new Date(occurrenceStart.getTime() + durationMs),
  };
}

function resolveConflictLink(reservation: {
  id: string;
  createdFromRequest: { ticketId: string } | null;
}) {
  const ticketId = reservation.createdFromRequest?.ticketId;
  if (ticketId) {
    return {
      linkType: "ticket" as const,
      linkHref: `/dashboard/tickets/${ticketId}`,
      linkLabel: "View ticket",
    };
  }

  return {
    linkType: "manual" as const,
    linkHref: `/dashboard/manual-reservation-history/${reservation.id}`,
    linkLabel: "View manual record",
  };
}

function toConflictItem(
  reservation: {
    id: string;
    description: string;
    kind: string;
    status: string;
    isRecurring: boolean;
    createdFromRequest: { ticketId: string } | null;
  },
  conflictOccurrenceStart: Date,
  conflictOccurrenceEnd: Date
): ConflictItem {
  const link = resolveConflictLink(reservation);
  return {
    reservationId: reservation.id,
    description: reservation.description,
    kind: reservation.kind,
    status: reservation.status,
    isRecurring: reservation.isRecurring,
    conflictOccurrenceStart: conflictOccurrenceStart.toISOString(),
    conflictOccurrenceEnd: conflictOccurrenceEnd.toISOString(),
    linkType: link.linkType,
    linkHref: link.linkHref,
    linkLabel: link.linkLabel,
  };
}

function dedupeConflicts(conflicts: ConflictItem[]) {
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    const key = `${c.reservationId}:${c.conflictOccurrenceStart}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectSingleOccurrenceConflicts(
  roomId: string,
  startAt: Date,
  endAt: Date,
  excludeIds: string[] = []
) {
  const approved = await prisma.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
    },
    include: {
      createdFromRequest: { select: { ticketId: true } },
    },
  });

  const conflicts: ConflictItem[] = [];

  for (const reservation of approved) {
    if (!reservation.isRecurring) {
      const overlaps = startAt < reservation.endAt && endAt > reservation.startAt;
      if (overlaps) {
        conflicts.push(toConflictItem(reservation, reservation.startAt, reservation.endAt));
      }
      continue;
    }

    const sameDay = (startAt.getUTCDay() || 7) === (reservation.startAt.getUTCDay() || 7);
    if (!sameDay) continue;
    if (startAt < reservation.startAt) continue;
    if (reservation.recurrenceEndDate && startAt > reservation.recurrenceEndDate) continue;
    if (!isWeeklyDateAligned(reservation.startAt, startAt)) continue;

    const reservationStartMinute = toMinuteOfDay(reservation.startAt);
    const reservationEndMinute = toMinuteOfDay(reservation.endAt);
    const startMinute = toMinuteOfDay(startAt);
    const endMinute = toMinuteOfDay(endAt);

    const overlaps = startMinute < reservationEndMinute && endMinute > reservationStartMinute;
    if (overlaps) {
      const { occurrenceStart, occurrenceEnd } = buildOccurrenceOnDate(reservation, startAt);
      conflicts.push(toConflictItem(reservation, occurrenceStart, occurrenceEnd));
    }
  }

  return dedupeConflicts(conflicts);
}

async function collectSeriesConflicts(
  roomId: string,
  seriesStart: Date,
  seriesEnd: Date | null,
  slotStartTemplate: Date,
  slotEndTemplate: Date,
  excludeIds: string[] = []
) {
  const approved = await prisma.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
    },
    include: {
      createdFromRequest: { select: { ticketId: true } },
    },
  });

  const slotStartMinute = toMinuteOfDay(slotStartTemplate);
  const slotEndMinute = toMinuteOfDay(slotEndTemplate);
  const conflicts: ConflictItem[] = [];

  for (const reservation of approved) {
    const reservationStartMinute = toMinuteOfDay(reservation.startAt);
    const reservationEndMinute = toMinuteOfDay(reservation.endAt);
    const sameTimeOverlap = slotStartMinute < reservationEndMinute && slotEndMinute > reservationStartMinute;
    if (!sameTimeOverlap) {
      continue;
    }

    if (!reservation.isRecurring) {
      if (!isWeeklyDateAligned(seriesStart, reservation.startAt)) {
        continue;
      }
      if (seriesEnd && reservation.startAt > seriesEnd) {
        continue;
      }

      conflicts.push(toConflictItem(reservation, reservation.startAt, reservation.endAt));
      continue;
    }

    const sameDay = (seriesStart.getUTCDay() || 7) === (reservation.startAt.getUTCDay() || 7);
    if (!sameDay) {
      continue;
    }

    const overlapStart = maxDate(seriesStart, reservation.startAt);
    const overlapEnd = seriesEnd && reservation.recurrenceEndDate
      ? minDate(seriesEnd, reservation.recurrenceEndDate)
      : seriesEnd ?? reservation.recurrenceEndDate ?? null;

    if (overlapEnd && overlapStart > overlapEnd) {
      continue;
    }

    const firstInOurSeries = findFirstSeriesOccurrenceOnOrAfter(seriesStart, overlapStart);
    if (overlapEnd && firstInOurSeries > overlapEnd) {
      continue;
    }

    if (!isWeeklyDateAligned(reservation.startAt, firstInOurSeries)) {
      continue;
    }

    const { occurrenceStart, occurrenceEnd } = buildOccurrenceOnDate(reservation, firstInOurSeries);
    conflicts.push(toConflictItem(reservation, occurrenceStart, occurrenceEnd));
  }

  return dedupeConflicts(conflicts);
}

/**
 * GET /api/reservations/manual-history/[id]/override-conflicts
 * Query: roomId, startAt, endAt, scope=single|all, occurrenceDate?
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await isReservationDepartmentAdmin(user);
  if (!canAccess) {
    return NextResponse.json({ error: "Only reservation department admins can preview override conflicts." }, { status: 403 });
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      isRecurring: true,
      startAt: true,
      endAt: true,
      recurrenceEndDate: true,
    },
  });

  if (!reservation || reservation.kind !== "MANUAL") {
    return NextResponse.json({ error: "Manual reservation not found." }, { status: 404 });
  }

  const { searchParams } = request.nextUrl;
  const roomId = searchParams.get("roomId");
  const startAtRaw = searchParams.get("startAt");
  const endAtRaw = searchParams.get("endAt");
  const scopeRaw = searchParams.get("scope") ?? "all";
  const occurrenceDate = searchParams.get("occurrenceDate") ?? undefined;

  if (!roomId || !startAtRaw || !endAtRaw) {
    return NextResponse.json({ error: "roomId, startAt and endAt are required." }, { status: 400 });
  }

  const startAt = new Date(startAtRaw);
  const endAt = new Date(endAtRaw);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
    return NextResponse.json({ error: "Invalid override time range." }, { status: 400 });
  }

  const scope = scopeRaw === "single" ? "single" : "all";
  const effectiveScope = reservation.isRecurring ? scope : "all";

  if (effectiveScope === "single" && !occurrenceDate) {
    return NextResponse.json({ error: "occurrenceDate is required for single scope." }, { status: 400 });
  }

  if (reservation.status !== "APPROVED") {
    return NextResponse.json({ conflicts: [] });
  }

  const excludeIds = [reservation.id];

  const conflicts = effectiveScope === "single"
    ? await collectSingleOccurrenceConflicts(roomId, startAt, endAt, excludeIds)
    : reservation.isRecurring
      ? await collectSeriesConflicts(
          roomId,
          startAt,
          reservation.recurrenceEndDate,
          startAt,
          endAt,
          excludeIds
        )
      : await collectSingleOccurrenceConflicts(roomId, startAt, endAt, excludeIds);

  return NextResponse.json({ conflicts });
}
