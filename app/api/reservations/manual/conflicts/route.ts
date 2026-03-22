import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ConflictItem = {
  reservationId: string;
  description: string;
  kind: "MANUAL" | "STANDARD_SCHEDULE";
  isRecurring: boolean;
  conflictOccurrenceStart: string;
  conflictOccurrenceEnd: string;
  linkType: "ticket" | "manual" | null;
  linkHref: string | null;
  linkLabel: string | null;
};

function toMinuteOfDay(date: Date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function toUtcMidnightMs(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addDaysUtc(date: Date, days: number) {
  return new Date(toUtcMidnightMs(date) + days * ONE_DAY_MS);
}

function isWeeklyDateAligned(base: Date, candidate: Date) {
  const diffDays = Math.floor((toUtcMidnightMs(candidate) - toUtcMidnightMs(base)) / ONE_DAY_MS);
  return diffDays >= 0 && diffDays % 7 === 0;
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
  kind: "MANUAL" | "STANDARD_SCHEDULE";
  createdFromRequest: { ticketId: string } | null;
  approvedByRequest: { ticketId: string } | null;
}) {
  const ticketId = reservation.createdFromRequest?.ticketId ?? reservation.approvedByRequest?.ticketId;
  if (ticketId) {
    return {
      linkType: "ticket" as const,
      linkHref: `/dashboard/tickets/${ticketId}`,
      linkLabel: "View Ticket",
    };
  }

  if (reservation.kind === "MANUAL") {
    return {
      linkType: "manual" as const,
      linkHref: `/dashboard/manual-reservation-history/${reservation.id}`,
      linkLabel: "View Record",
    };
  }

  return {
    linkType: null,
    linkHref: null,
    linkLabel: null,
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

/**
 * GET /api/reservations/manual/conflicts
 * Query: roomId, startAt, endAt, isRecurring=true|false, recurrenceEndDate?
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Only admins can preview conflicts." }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const roomId = searchParams.get("roomId");
  const startAtRaw = searchParams.get("startAt");
  const endAtRaw = searchParams.get("endAt");
  const isRecurring = searchParams.get("isRecurring") === "true";
  const recurrenceEndDateRaw = searchParams.get("recurrenceEndDate");

  if (!roomId || !startAtRaw || !endAtRaw) {
    return NextResponse.json({ error: "roomId, startAt and endAt are required." }, { status: 400 });
  }

  const startAt = new Date(startAtRaw);
  const endAt = new Date(endAtRaw);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt >= endAt) {
    return NextResponse.json({ error: "Invalid time range." }, { status: 400 });
  }

  const recurrenceEndDate = isRecurring && recurrenceEndDateRaw
    ? new Date(`${recurrenceEndDateRaw}T23:59:59.999Z`)
    : null;

  if (isRecurring && recurrenceEndDate && (Number.isNaN(recurrenceEndDate.getTime()) || recurrenceEndDate < startAt)) {
    return NextResponse.json({ error: "Invalid recurrenceEndDate." }, { status: 400 });
  }

  const approved = await prisma.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
    },
    select: {
      id: true,
      kind: true,
      description: true,
      isRecurring: true,
      startAt: true,
      endAt: true,
      recurrenceEndDate: true,
      createdFromRequest: { select: { ticketId: true } },
      approvedByRequest: { select: { ticketId: true } },
    },
  });

  const conflicts: ConflictItem[] = [];

  const slotStartMinute = toMinuteOfDay(startAt);
  const slotEndMinute = toMinuteOfDay(endAt);
  for (const reservation of approved) {
    const otherStartMinute = toMinuteOfDay(reservation.startAt);
    const otherEndMinute = toMinuteOfDay(reservation.endAt);
    const sameTimeOverlap = slotStartMinute < otherEndMinute && slotEndMinute > otherStartMinute;
    if (!sameTimeOverlap) continue;

    const link = resolveConflictLink(reservation);

    if (!isRecurring) {
      if (!reservation.isRecurring) {
        if (reservation.startAt < endAt && reservation.endAt > startAt) {
          conflicts.push({
            reservationId: reservation.id,
            description: reservation.description,
            kind: reservation.kind,
            isRecurring: reservation.isRecurring,
            conflictOccurrenceStart: reservation.startAt.toISOString(),
            conflictOccurrenceEnd: reservation.endAt.toISOString(),
            linkType: link.linkType,
            linkHref: link.linkHref,
            linkLabel: link.linkLabel,
          });
        }
      } else {
        const sameDay = (startAt.getUTCDay() || 7) === (reservation.startAt.getUTCDay() || 7);
        if (!sameDay) continue;
        if (startAt < reservation.startAt) continue;
        if (reservation.recurrenceEndDate && startAt > reservation.recurrenceEndDate) continue;
        if (!isWeeklyDateAligned(reservation.startAt, startAt)) continue;

        const { occurrenceStart, occurrenceEnd } = buildOccurrenceOnDate(reservation, startAt);

        conflicts.push({
          reservationId: reservation.id,
          description: reservation.description,
          kind: reservation.kind,
          isRecurring: reservation.isRecurring,
          conflictOccurrenceStart: occurrenceStart.toISOString(),
          conflictOccurrenceEnd: occurrenceEnd.toISOString(),
          linkType: link.linkType,
          linkHref: link.linkHref,
          linkLabel: link.linkLabel,
        });
      }
      continue;
    }

    if (recurrenceEndDate && startAt > recurrenceEndDate) {
      continue;
    }

    if (!reservation.isRecurring) {
      if (!isWeeklyDateAligned(startAt, reservation.startAt)) continue;
      if (recurrenceEndDate && reservation.startAt > recurrenceEndDate) continue;

      conflicts.push({
        reservationId: reservation.id,
        description: reservation.description,
        kind: reservation.kind,
        isRecurring: reservation.isRecurring,
        conflictOccurrenceStart: reservation.startAt.toISOString(),
        conflictOccurrenceEnd: reservation.endAt.toISOString(),
        linkType: link.linkType,
        linkHref: link.linkHref,
        linkLabel: link.linkLabel,
      });
      continue;
    }

    const sameDay = (startAt.getUTCDay() || 7) === (reservation.startAt.getUTCDay() || 7);
    if (!sameDay) continue;

    const overlapStart = maxDate(startAt, reservation.startAt);
    const overlapEnd = recurrenceEndDate && reservation.recurrenceEndDate
      ? minDate(recurrenceEndDate, reservation.recurrenceEndDate)
      : recurrenceEndDate ?? reservation.recurrenceEndDate ?? null;

    if (overlapEnd && overlapStart > overlapEnd) continue;

    const firstInOurSeries = findFirstSeriesOccurrenceOnOrAfter(startAt, overlapStart);
    if (overlapEnd && firstInOurSeries > overlapEnd) continue;
    if (!isWeeklyDateAligned(reservation.startAt, firstInOurSeries)) continue;

    const { occurrenceStart, occurrenceEnd } = buildOccurrenceOnDate(reservation, firstInOurSeries);

    conflicts.push({
      reservationId: reservation.id,
      description: reservation.description,
      kind: reservation.kind,
      isRecurring: reservation.isRecurring,
      conflictOccurrenceStart: occurrenceStart.toISOString(),
      conflictOccurrenceEnd: occurrenceEnd.toISOString(),
      linkType: link.linkType,
      linkHref: link.linkHref,
      linkLabel: link.linkLabel,
    });
  }

  return NextResponse.json({ conflicts: dedupeConflicts(conflicts) });
}
