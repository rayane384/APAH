import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../lib/auth-helpers";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

  const { isRecurring, recurrenceEndDate: recurrenceEndDateStr } = body as any;

  // Calculate dates
  const datesToBook: { startAt: Date; endAt: Date }[] = [];
  datesToBook.push({ startAt: start, endAt: end });

  if (isRecurring && recurrenceEndDateStr) {
    const recurrenceEndDate = new Date(recurrenceEndDateStr + "T23:59:59Z");
    if (!isNaN(recurrenceEndDate.getTime())) {
      let nextStart = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      let nextEnd = new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000);
      while (nextStart <= recurrenceEndDate) {
        datesToBook.push({ startAt: new Date(nextStart), endAt: new Date(nextEnd) });
        nextStart.setTime(nextStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        nextEnd.setTime(nextEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const approved = await tx.reservation.findMany({
      where: {
        roomId: room.id,
        status: "APPROVED",
      },
      select: {
        id: true,
        isRecurring: true,
        startAt: true,
        endAt: true,
        recurrenceEndDate: true,
      },
    });

    const slotStartMinute = toMinuteOfDay(start);
    const slotEndMinute = toMinuteOfDay(end);

    for (const reservation of approved) {
      const reservationStartMinute = toMinuteOfDay(reservation.startAt);
      const reservationEndMinute = toMinuteOfDay(reservation.endAt);
      const sameTimeOverlap = slotStartMinute < reservationEndMinute && slotEndMinute > reservationStartMinute;
      if (!sameTimeOverlap) continue;

      if (!isRecurring) {
        if (!reservation.isRecurring) {
          if (reservation.startAt < end && reservation.endAt > start) {
            throw new Error(`This slot conflicts with an approved reservation on ${start.toISOString().split("T")[0]}.`);
          }
        } else {
          const sameDay = (start.getUTCDay() || 7) === (reservation.startAt.getUTCDay() || 7);
          if (!sameDay) continue;
          if (start < reservation.startAt) continue;
          if (reservation.recurrenceEndDate && start > reservation.recurrenceEndDate) continue;
          if (!isWeeklyDateAligned(reservation.startAt, start)) continue;

          throw new Error(`This slot conflicts with an approved reservation on ${start.toISOString().split("T")[0]}.`);
        }
        continue;
      }

      const recurrenceEndDate = recurrenceEndDateStr ? new Date(`${recurrenceEndDateStr}T23:59:59.999Z`) : null;
      if (recurrenceEndDate && start > recurrenceEndDate) {
        throw new Error("Invalid recurrence end date.");
      }

      if (!reservation.isRecurring) {
        if (!isWeeklyDateAligned(start, reservation.startAt)) continue;
        if (recurrenceEndDate && reservation.startAt > recurrenceEndDate) continue;

        throw new Error(`This recurring series conflicts with an approved reservation on ${reservation.startAt.toISOString().split("T")[0]}.`);
      }

      const sameDay = (start.getUTCDay() || 7) === (reservation.startAt.getUTCDay() || 7);
      if (!sameDay) continue;

      const overlapStart = maxDate(start, reservation.startAt);
      const overlapEnd = recurrenceEndDate && reservation.recurrenceEndDate
        ? minDate(recurrenceEndDate, reservation.recurrenceEndDate)
        : recurrenceEndDate ?? reservation.recurrenceEndDate ?? null;

      if (overlapEnd && overlapStart > overlapEnd) continue;

      const firstInOurSeries = findFirstSeriesOccurrenceOnOrAfter(start, overlapStart);
      if (overlapEnd && firstInOurSeries > overlapEnd) continue;
      if (!isWeeklyDateAligned(reservation.startAt, firstInOurSeries)) continue;

      throw new Error(`This recurring series conflicts with an approved reservation on ${firstInOurSeries.toISOString().split("T")[0]}.`);
    }

    // Create a single database record for the recurring series
    const reservation = await tx.reservation.create({
      data: {
        kind: "MANUAL",
        status: "APPROVED",
        roomId: room.id,
        campusId: room.campusId,
        startAt: start,
        endAt: end,
        description: description?.trim() || `Manual reservation by ${user.name ?? "Admin"}`,
        createdById: user.id,
        isRecurring: isRecurring ?? false,
        recurrenceEndDate: isRecurring && recurrenceEndDateStr ? new Date(recurrenceEndDateStr + "T23:59:59Z") : null,
      },
      include: {
        room: { include: { campus: true, roomType: true } },
        campus: true,
      },
    });

    return reservation;
  });

  if (!result) {
    return NextResponse.json({ error: "Could not create reservation." }, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
