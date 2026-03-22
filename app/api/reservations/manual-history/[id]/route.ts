import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/auth-helpers";
import { isReservationDepartmentAdmin } from "../../../../lib/reservation-admin";

type Params = { params: Promise<{ id: string }> };

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ReservationEntity = Awaited<ReturnType<typeof prisma.reservation.findUnique>>;

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

function sameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function dateOnlyUtc(input: string) {
  return new Date(`${input}T00:00:00.000Z`);
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

  const diff = occurrenceStart.getTime() - baseStart.getTime();
  if (diff % ONE_WEEK_MS !== 0) {
    return null;
  }

  return { occurrenceStart, occurrenceEnd };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function recurringOverlaps(recurring: NonNullable<ReservationEntity>, candidateStart: Date, candidateEnd: Date) {
  const recStart = recurring.startAt;
  const recEnd = recurring.endAt;

  const candidateDay = candidateStart.getUTCDay() || 7;
  const recurringDay = recStart.getUTCDay() || 7;
  if (candidateDay !== recurringDay) {
    return false;
  }

  if (candidateStart < recStart) {
    return false;
  }

  if (recurring.recurrenceEndDate && candidateStart > recurring.recurrenceEndDate) {
    return false;
  }

  if (!isWeeklyDateAligned(recStart, candidateStart)) {
    return false;
  }

  const recStartMinute = toMinuteOfDay(recStart);
  const recEndMinute = toMinuteOfDay(recEnd);
  const candidateStartMinute = toMinuteOfDay(candidateStart);
  const candidateEndMinute = toMinuteOfDay(candidateEnd);

  return candidateStartMinute < recEndMinute && candidateEndMinute > recStartMinute;
}

function minDate(a: Date, b: Date) {
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

async function findApprovedConflictForWeeklySeries(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">,
  roomId: string,
  seriesStart: Date,
  seriesEnd: Date | null,
  slotStartTemplate: Date,
  slotEndTemplate: Date,
  excludeIds: string[] = []
) {
  const approved = await tx.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
    },
  });

  const slotStartMinute = toMinuteOfDay(slotStartTemplate);
  const slotEndMinute = toMinuteOfDay(slotEndTemplate);

  return approved.find((reservation) => {
    const otherStartMinute = toMinuteOfDay(reservation.startAt);
    const otherEndMinute = toMinuteOfDay(reservation.endAt);
    const sameTimeOverlap = slotStartMinute < otherEndMinute && slotEndMinute > otherStartMinute;
    if (!sameTimeOverlap) {
      return false;
    }

    if (!reservation.isRecurring) {
      if (!isWeeklyDateAligned(seriesStart, reservation.startAt)) {
        return false;
      }
      if (seriesEnd && reservation.startAt > seriesEnd) {
        return false;
      }
      return true;
    }

    const ourDay = seriesStart.getUTCDay() || 7;
    const theirDay = reservation.startAt.getUTCDay() || 7;
    if (ourDay !== theirDay) {
      return false;
    }

    const overlapStart = maxDate(seriesStart, reservation.startAt);

    let overlapEnd: Date | null = null;
    if (seriesEnd && reservation.recurrenceEndDate) {
      overlapEnd = minDate(seriesEnd, reservation.recurrenceEndDate);
    } else {
      overlapEnd = seriesEnd ?? reservation.recurrenceEndDate ?? null;
    }

    if (overlapEnd && overlapStart > overlapEnd) {
      return false;
    }

    let firstInOurSeries = new Date(seriesStart);
    if (firstInOurSeries < overlapStart) {
      const diffDays = Math.ceil((toUtcMidnightMs(overlapStart) - toUtcMidnightMs(seriesStart)) / ONE_DAY_MS);
      const weeksToAdvance = Math.ceil(diffDays / 7);
      firstInOurSeries = new Date(seriesStart.getTime() + weeksToAdvance * ONE_WEEK_MS);
    }

    if (overlapEnd && firstInOurSeries > overlapEnd) {
      return false;
    }

    return isWeeklyDateAligned(reservation.startAt, firstInOurSeries);
  }) ?? null;
}

async function findApprovedConflict(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">,
  roomId: string,
  startAt: Date,
  endAt: Date,
  excludeIds: string[] = []
) {
  const approved = await tx.reservation.findMany({
    where: {
      roomId,
      status: "APPROVED",
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
    },
  });

  return approved.find((reservation) => {
    if (!reservation.isRecurring) {
      return overlaps(startAt, endAt, reservation.startAt, reservation.endAt);
    }
    return recurringOverlaps(reservation, startAt, endAt);
  }) ?? null;
}

function computeOccurrenceCount(reservation: NonNullable<ReservationEntity>) {
  if (!reservation.isRecurring) {
    return 1;
  }
  if (!reservation.recurrenceEndDate) {
    return null;
  }

  if (reservation.recurrenceEndDate < reservation.startAt) {
    return 0;
  }

  const diff = reservation.recurrenceEndDate.getTime() - reservation.startAt.getTime();
  return Math.floor(diff / ONE_WEEK_MS) + 1;
}

async function removeRecurringOccurrence(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">,
  reservation: NonNullable<ReservationEntity>,
  occurrenceStart: Date
) {
  const durationMs = reservation.endAt.getTime() - reservation.startAt.getTime();
  const prevOccurrenceStart = new Date(occurrenceStart.getTime() - ONE_WEEK_MS);
  const nextOccurrenceStart = new Date(occurrenceStart.getTime() + ONE_WEEK_MS);

  const hasBefore = prevOccurrenceStart >= reservation.startAt;
  const hasAfter = reservation.recurrenceEndDate
    ? nextOccurrenceStart <= reservation.recurrenceEndDate
    : true;

  if (!hasBefore && !hasAfter) {
    await tx.reservation.update({
      where: { id: reservation.id },
      data: { status: "CANCELLED" },
    });
    return;
  }

  if (!hasBefore && hasAfter) {
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        startAt: nextOccurrenceStart,
        endAt: new Date(nextOccurrenceStart.getTime() + durationMs),
      },
    });
    return;
  }

  if (hasBefore && !hasAfter) {
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        recurrenceEndDate: new Date(occurrenceStart.getTime() - 1),
      },
    });
    return;
  }

  const originalEnd = reservation.recurrenceEndDate;

  await tx.reservation.update({
    where: { id: reservation.id },
    data: {
      recurrenceEndDate: new Date(occurrenceStart.getTime() - 1),
    },
  });

  await tx.reservation.create({
    data: {
      kind: reservation.kind,
      status: "APPROVED",
      roomId: reservation.roomId,
      campusId: reservation.campusId,
      startAt: nextOccurrenceStart,
      endAt: new Date(nextOccurrenceStart.getTime() + durationMs),
      description: reservation.description,
      isRecurring: true,
      recurrenceEndDate: originalEnd,
      importBatchId: reservation.importBatchId,
      createdById: reservation.createdById,
    },
  });
}

async function getReservationOr404(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    include: {
      room: {
        include: {
          campus: { select: { id: true, name: true, code: true } },
          roomType: { select: { id: true, name: true, code: true } },
        },
      },
      campus: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, fullName: true, email: true } },
      importBatch: {
        select: {
          id: true,
          fileName: true,
          createdAt: true,
          recurrenceEndDate: true,
          importedBy: { select: { id: true, fullName: true, email: true } },
        },
      },
    },
  });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await isReservationDepartmentAdmin(user);
  if (!canAccess) {
    return NextResponse.json({ error: "Only reservation department admins can view manual history." }, { status: 403 });
  }

  const reservation = await getReservationOr404(id);
  if (!reservation || reservation.kind !== "MANUAL") {
    return NextResponse.json({ error: "Manual reservation not found." }, { status: 404 });
  }

  const occurrenceCount = computeOccurrenceCount(reservation);

  return NextResponse.json({
    ...reservation,
    canAct: reservation.status === "APPROVED",
    occurrenceCount,
  });
}

/**
 * PATCH /api/reservations/manual-history/[id]
 * Body:
 * {
 *   action: "cancel" | "override",
 *   scope?: "single" | "all",
 *   occurrenceDate?: "YYYY-MM-DD",
 *   roomId?: string,
 *   startAt?: string,
 *   endAt?: string,
 *   description?: string
 * }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await isReservationDepartmentAdmin(user);
  if (!canAccess) {
    return NextResponse.json({ error: "Only reservation department admins can manage manual history." }, { status: 403 });
  }

  const body = await request.json();
  const { action, scope = "all", occurrenceDate, roomId, startAt, endAt, description } = body as {
    action: "cancel" | "override";
    scope?: "single" | "all";
    occurrenceDate?: string;
    roomId?: string;
    startAt?: string;
    endAt?: string;
    description?: string;
  };

  if (action !== "cancel" && action !== "override") {
    return NextResponse.json({ error: "Invalid action. Use cancel or override." }, { status: 400 });
  }

  const reservation = await prisma.reservation.findUnique({ where: { id } });
  if (!reservation || reservation.kind !== "MANUAL") {
    return NextResponse.json({ error: "Manual reservation not found." }, { status: 404 });
  }

  if (reservation.status !== "APPROVED") {
    return NextResponse.json(
      { error: "This reservation is cancelled. No further action can be made." },
      { status: 400 }
    );
  }

  const effectiveScope = reservation.isRecurring ? scope : "all";

  if (effectiveScope === "single" && !occurrenceDate) {
    return NextResponse.json({ error: "occurrenceDate is required for single scope." }, { status: 400 });
  }

  if (action === "cancel") {
    await prisma.$transaction(async (tx) => {
      if (effectiveScope === "all") {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: "CANCELLED" },
        });
        return;
      }

      const occurrence = buildOccurrenceForDate(reservation, occurrenceDate!);
      if (!occurrence) {
        throw new Error("Invalid occurrenceDate for this recurring reservation.");
      }

      await removeRecurringOccurrence(tx, reservation, occurrence.occurrenceStart);

      await tx.reservation.create({
        data: {
          kind: "MANUAL",
          status: "CANCELLED",
          roomId: reservation.roomId,
          campusId: reservation.campusId,
          startAt: occurrence.occurrenceStart,
          endAt: occurrence.occurrenceEnd,
          description: `Cancelled occurrence (${reservation.id.slice(-8).toUpperCase()})`,
          isRecurring: false,
          createdById: user.id,
        },
      });
    });

    const updated = await getReservationOr404(id);
    return NextResponse.json({
      reservation: updated,
      message: "Reservation cancelled successfully.",
    });
  }

  if (!roomId || !startAt || !endAt) {
    return NextResponse.json({ error: "Override requires roomId, startAt, and endAt." }, { status: 400 });
  }

  const overrideStart = new Date(startAt);
  const overrideEnd = new Date(endAt);

  if (Number.isNaN(overrideStart.getTime()) || Number.isNaN(overrideEnd.getTime()) || overrideStart >= overrideEnd) {
    return NextResponse.json({ error: "Invalid override time range." }, { status: 400 });
  }

  let normalizedOverrideStart = overrideStart;
  let normalizedOverrideEnd = overrideEnd;
  let normalizedRecurrenceEndDate = reservation.recurrenceEndDate;

  if (effectiveScope === "all" && reservation.isRecurring) {
    normalizedOverrideStart = overrideStart;
    normalizedOverrideEnd = overrideEnd;

    const originalCount = computeOccurrenceCount(reservation);
    if (originalCount !== null) {
      normalizedRecurrenceEndDate = new Date(normalizedOverrideStart.getTime() + (Math.max(1, originalCount) - 1) * ONE_WEEK_MS);
    }
  }

  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, campusId: true } });
  if (!room) {
    return NextResponse.json({ error: "Room not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (effectiveScope === "all") {
      if (reservation.isRecurring && normalizedRecurrenceEndDate && normalizedOverrideStart > normalizedRecurrenceEndDate) {
        throw new Error("Override start date is after recurrence end date.");
      }

      const conflict = reservation.isRecurring
        ? await findApprovedConflictForWeeklySeries(
            tx,
            room.id,
            normalizedOverrideStart,
            normalizedRecurrenceEndDate,
            normalizedOverrideStart,
            normalizedOverrideEnd,
            [reservation.id]
          )
        : await findApprovedConflict(tx, room.id, normalizedOverrideStart, normalizedOverrideEnd, [reservation.id]);

      if (conflict) {
        throw new Error("Cannot override: the target slot conflicts with an approved reservation in this series.");
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          roomId: room.id,
          campusId: room.campusId,
          startAt: normalizedOverrideStart,
          endAt: normalizedOverrideEnd,
          recurrenceEndDate: reservation.isRecurring ? normalizedRecurrenceEndDate : reservation.recurrenceEndDate,
          description: description?.trim() || reservation.description,
          createdById: user.id,
        },
      });

      return;
    }

    const occurrence = buildOccurrenceForDate(reservation, occurrenceDate!);
    if (!occurrence) {
      throw new Error("Invalid occurrenceDate for this recurring reservation.");
    }

    const conflict = await findApprovedConflict(tx, room.id, overrideStart, overrideEnd, [reservation.id]);
    if (conflict) {
      throw new Error("Cannot override: the target slot has an approved reservation.");
    }

    await removeRecurringOccurrence(tx, reservation, occurrence.occurrenceStart);

    await tx.reservation.create({
      data: {
        kind: "MANUAL",
        status: "APPROVED",
        roomId: room.id,
        campusId: room.campusId,
        startAt: overrideStart,
        endAt: overrideEnd,
        description: description?.trim() || `Override occurrence (${reservation.id.slice(-8).toUpperCase()})`,
        isRecurring: false,
        createdById: user.id,
      },
    });
  });

  const updated = await getReservationOr404(id);
  return NextResponse.json({
    reservation: updated,
    message: "Reservation overridden successfully.",
  });
}
