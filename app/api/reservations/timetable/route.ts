import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../lib/auth-helpers";
import * as XLSX from "xlsx";

const DAY_MAP: Record<string, number> = {
  LUNDI: 1,
  MARDI: 2,
  MERCREDI: 3,
  JEUDI: 4,
  VENDREDI: 5,
  SAMEDI: 6,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const DAY_NAME_BY_NUM: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const TIMETABLE_START_MINUTE = 8 * 60 + 30; // 08:30
const TIMETABLE_END_MINUTE = 18 * 60 + 30; // 18:30
const ALLOWED_SLOT_DURATIONS = new Set([60, 75, 90, 105, 120]);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

/** Parse times like "08H30" or "10:00" into { hour, minute } */
function parseTime(raw: string): { hour: number; minute: number } | null {
  const value = raw.trim().toUpperCase();
  const m = value.match(/^(\d{1,2})(?:H|:)(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseDayOfWeek(raw: string): { dayOfWeek: number; dayName: string } | null {
  const dayKey = raw.trim().toUpperCase();
  if (!dayKey) return null;
  const dayOfWeek = DAY_MAP[dayKey];
  if (dayOfWeek === undefined) return null;
  return { dayOfWeek, dayName: DAY_NAME_BY_NUM[dayOfWeek] ?? dayKey };
}

function validateSlotTiming(slot: ParsedSlot): string | null {
  const startMinuteOfDay = slot.startHour * 60 + slot.startMinute;
  const endMinuteOfDay = slot.endHour * 60 + slot.endMinute;

  if (endMinuteOfDay <= startMinuteOfDay) {
    return "end time must be after start time.";
  }
  if (startMinuteOfDay < TIMETABLE_START_MINUTE || endMinuteOfDay > TIMETABLE_END_MINUTE) {
    return "time must be within 08:30 and 18:30.";
  }

  const duration = endMinuteOfDay - startMinuteOfDay;
  if (!ALLOWED_SLOT_DURATIONS.has(duration)) {
    return "duration must be one of 60, 75, 90, 105, 120 minutes.";
  }

  return null;
}

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

function recurringOverlapsSingle(
  recurringStart: Date,
  recurringEnd: Date,
  recurringSeriesEnd: Date | null,
  singleStart: Date,
  singleEnd: Date
) {
  const recurringDay = recurringStart.getUTCDay() || 7;
  const singleDay = singleStart.getUTCDay() || 7;
  if (recurringDay !== singleDay) return false;

  const recurringStartMinute = toMinuteOfDay(recurringStart);
  const recurringEndMinute = toMinuteOfDay(recurringEnd);
  const singleStartMinute = toMinuteOfDay(singleStart);
  const singleEndMinute = toMinuteOfDay(singleEnd);
  if (!(singleStartMinute < recurringEndMinute && singleEndMinute > recurringStartMinute)) {
    return false;
  }

  if (singleStart < recurringStart) return false;
  if (recurringSeriesEnd && singleStart > recurringSeriesEnd) return false;

  return isWeeklyDateAligned(recurringStart, singleStart);
}

function recurringOverlapsRecurring(
  startA: Date,
  endA: Date,
  endSeriesA: Date | null,
  startB: Date,
  endB: Date,
  endSeriesB: Date | null
) {
  const dayA = startA.getUTCDay() || 7;
  const dayB = startB.getUTCDay() || 7;
  if (dayA !== dayB) return false;

  const startMinuteA = toMinuteOfDay(startA);
  const endMinuteA = toMinuteOfDay(endA);
  const startMinuteB = toMinuteOfDay(startB);
  const endMinuteB = toMinuteOfDay(endB);
  if (!(startMinuteA < endMinuteB && endMinuteA > startMinuteB)) {
    return false;
  }

  const overlapStart = startA > startB ? startA : startB;
  const overlapEnd = endSeriesA && endSeriesB
    ? (endSeriesA < endSeriesB ? endSeriesA : endSeriesB)
    : endSeriesA ?? endSeriesB;

  if (overlapEnd && overlapStart > overlapEnd) return false;

  let firstOccurrenceA = new Date(startA);
  if (firstOccurrenceA < overlapStart) {
    const diffDays = Math.ceil((toUtcMidnightMs(overlapStart) - toUtcMidnightMs(startA)) / ONE_DAY_MS);
    const weeksToAdvance = Math.ceil(diffDays / 7);
    firstOccurrenceA = new Date(startA.getTime() + weeksToAdvance * ONE_WEEK_MS);
  }

  if (overlapEnd && firstOccurrenceA > overlapEnd) return false;
  return isWeeklyDateAligned(startB, firstOccurrenceA);
}

function reservationConflictsWithImportedSeries(
  existing: {
    isRecurring: boolean;
    startAt: Date;
    endAt: Date;
    recurrenceEndDate: Date | null;
  },
  importedStart: Date,
  importedEnd: Date,
  importedSeriesEnd: Date
) {
  if (!existing.isRecurring) {
    return recurringOverlapsSingle(importedStart, importedEnd, importedSeriesEnd, existing.startAt, existing.endAt);
  }

  return recurringOverlapsRecurring(
    importedStart,
    importedEnd,
    importedSeriesEnd,
    existing.startAt,
    existing.endAt,
    existing.recurrenceEndDate
  );
}

/**
 * Extract room code and campus name from timetable cell content.
 * Expected format: "ROOM_CODE (CAMPUS_NAME)" e.g. "1C (EMSI HASSAN)"
 * Also tries: "ROOM_CODE(CAMPUS_NAME)" and standalone room code
 */
function extractRoomAndCampus(text: string): { roomCode: string; campusName: string } | null {
  // Pattern: ROOM_CODE (CAMPUS_NAME) or ROOM_CODE(CAMPUS_NAME)
  const match = text.match(/^([A-Z0-9_]+(?:\s*[A-Z0-9_]*)*?)\s*\(\s*(.+?)\s*\)$/i);
  if (match) {
    return { roomCode: match[1].trim(), campusName: match[2].trim() };
  }

  // Pattern: ROOM / CAMPUS
  const slashParts = text
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (slashParts.length >= 2) {
    return {
      roomCode: slashParts[0],
      campusName: slashParts.slice(1).join(" / "),
    };
  }

  return null;
}

type ParsedSlot = {
  dayOfWeek: number; // 1=Mon … 6=Sat
  dayName: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  description: string;
  roomCode: string | null;
  campusName: string | null;
};

function parseFlatTimetable(rows: (string | number | null)[][]): ParsedSlot[] {
  let headerRow = -1;

  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r] ?? [];
    const normalized = row.map((cell) => String(cell ?? "").trim().toLowerCase());
    const hasDay = normalized.some((c) => c.includes("day"));
    const hasStart = normalized.some((c) => c.includes("start"));
    const hasEnd = normalized.some((c) => c.includes("end"));
    if (hasDay && hasStart && hasEnd) {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) return [];

  const slots: ParsedSlot[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const dayRaw = String(row[0] ?? "").trim();
    const startRaw = String(row[1] ?? "").trim();
    const endRaw = String(row[2] ?? "").trim();
    const description = String(row[3] ?? "").trim();
    const roomCampusRaw = String(row[4] ?? "").trim();

    if (!dayRaw && !startRaw && !endRaw && !description && !roomCampusRaw) {
      continue;
    }

    const day = parseDayOfWeek(dayRaw);
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);
    if (!day || !start || !end || !description) {
      continue;
    }

    let roomCode: string | null = null;
    let campusName: string | null = null;
    if (roomCampusRaw) {
      const roomInfo = extractRoomAndCampus(roomCampusRaw);
      if (roomInfo) {
        roomCode = roomInfo.roomCode;
        campusName = roomInfo.campusName;
      } else {
        roomCode = roomCampusRaw;
      }
    }

    slots.push({
      dayOfWeek: day.dayOfWeek,
      dayName: day.dayName,
      startHour: start.hour,
      startMinute: start.minute,
      endHour: end.hour,
      endMinute: end.minute,
      description,
      roomCode,
      campusName,
    });
  }

  return slots;
}

function parseLegacyMatrixTimetable(rows: (string | number | null)[][]): ParsedSlot[] {
  if (rows.length < 3) return [];

  let timeRow = -1;
  type SessionDef = { col: number; startH: number; startM: number; endH: number; endM: number };
  const sessions: SessionDef[] = [];

  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const row = rows[r];
    if (!row) continue;

    const timeCells: { col: number; hour: number; minute: number }[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "").trim();
      const parsed = parseTime(cell);
      if (parsed) {
        timeCells.push({ col: c, ...parsed });
      }
    }

    if (timeCells.length >= 2) {
      timeRow = r;
      for (let i = 0; i < timeCells.length - 1; i += 2) {
        sessions.push({
          col: timeCells[i].col,
          startH: timeCells[i].hour,
          startM: timeCells[i].minute,
          endH: timeCells[i + 1].hour,
          endM: timeCells[i + 1].minute,
        });
      }
      break;
    }
  }

  if (sessions.length === 0) return [];

  const slots: ParsedSlot[] = [];

  for (let r = timeRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    let day: { dayOfWeek: number; dayName: string } | null = null;
    for (let c = 0; c < Math.min(3, row.length); c++) {
      const cell = String(row[c] ?? "").trim();
      const parsedDay = parseDayOfWeek(cell);
      if (parsedDay) {
        day = parsedDay;
        break;
      }
    }

    if (!day) continue;

    const dayRows: (string | number | null)[][] = [row];
    for (let nr = r + 1; nr < Math.min(r + 5, rows.length); nr++) {
      const nextRow = rows[nr];
      if (!nextRow) break;
      let isNewDay = false;
      for (let c = 0; c < Math.min(3, nextRow.length); c++) {
        const cell = String(nextRow[c] ?? "").trim();
        if (parseDayOfWeek(cell)) {
          isNewDay = true;
          break;
        }
      }
      if (isNewDay) break;
      dayRows.push(nextRow);
    }

    for (const session of sessions) {
      const textParts: string[] = [];
      let roomCode: string | null = null;
      let campusName: string | null = null;

      for (const dr of dayRows) {
        for (let sc = session.col; sc <= session.col + 1 && sc < dr.length; sc++) {
          const cell = String(dr[sc] ?? "").trim();
          if (!cell || parseTime(cell)) continue;

          const roomInfo = extractRoomAndCampus(cell);
          if (roomInfo) {
            roomCode = roomInfo.roomCode;
            campusName = roomInfo.campusName;
          } else {
            textParts.push(cell);
          }
        }
      }

      if (textParts.length > 0) {
        slots.push({
          dayOfWeek: day.dayOfWeek,
          dayName: day.dayName,
          startHour: session.startH,
          startMinute: session.startM,
          endHour: session.endH,
          endMinute: session.endM,
          description: textParts.join(" — "),
          roomCode,
          campusName,
        });
      }
    }
  }

  return slots;
}

/**
 * Parse the timetable Excel file.
 * Supports:
 * - Flat format: one row per reservation slot (Day, Start, End, Subject, Room/Campus)
 * - Legacy matrix format: LUNDI..SAMEDI rows with paired session columns
 */
function parseTimetable(buffer: Buffer): ParsedSlot[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  if (rows.length < 2) return [];

  const flatSlots = parseFlatTimetable(rows);
  if (flatSlots.length > 0) {
    return flatSlots;
  }

  return parseLegacyMatrixTimetable(rows);
}

/**
 * POST /api/reservations/timetable
 * Upload an Excel timetable and create recurring reservations.
 * Rooms are parsed from the timetable cells (format: "ROOM_CODE (CAMPUS_NAME)").
 * Imported timetable reservations have highest priority:
 * - Pending requests on conflicting slots are automatically declined
 * - Conflicts with already-approved reservations produce warnings
 *
 * Form data: file (xlsx), recurrenceEndDate, description (optional)
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Only admins can import timetables." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const recurrenceEndDateStr = formData.get("recurrenceEndDate") as string | null;
  const description = formData.get("description") as string | null;
  const isPreview = formData.get("preview") === "true";

  if (!file) {
    return NextResponse.json({ error: "Excel file is required." }, { status: 400 });
  }
  if (!recurrenceEndDateStr) {
    return NextResponse.json({ error: "recurrenceEndDate is required." }, { status: 400 });
  }

  const recurrenceEndDate = new Date(recurrenceEndDateStr + "T23:59:59Z");
  if (isNaN(recurrenceEndDate.getTime())) {
    return NextResponse.json({ error: "Invalid recurrenceEndDate." }, { status: 400 });
  }

  // Parse the Excel
  const buffer = Buffer.from(await file.arrayBuffer());
  const slots = parseTimetable(buffer);

  if (slots.length === 0) {
    return NextResponse.json(
      { error: "Could not parse any time slots from the timetable. Use the flat template format (Day, Start Time, End Time, Subject, Room/Campus) or the legacy grid format with LUNDI-SAMEDI and time headers like 08H30." },
      { status: 400 }
    );
  }

  // Load all rooms with their campuses for matching
  const allRooms = await prisma.room.findMany({
    include: { campus: true },
  });

  // Match parsed slots to rooms
  type MatchedSlot = ParsedSlot & { roomId: string; campusId: string; roomName: string; campusDisplayName: string };
  const matchedSlots: MatchedSlot[] = [];
  const unmatchedSlots: { slot: ParsedSlot; reason: string }[] = [];

  for (const slot of slots) {
    const timingError = validateSlotTiming(slot);
    if (timingError) {
      unmatchedSlots.push({
        slot,
        reason: `Invalid time range (${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")} - ${String(slot.endHour).padStart(2, "0")}:${String(slot.endMinute).padStart(2, "0")}): ${timingError}`,
      });
      continue;
    }

    if (!slot.roomCode) {
      unmatchedSlots.push({
        slot,
        reason: "No room info found in timetable cell. Expected format: ROOM_CODE (CAMPUS_NAME)",
      });
      continue;
    }

    // Find matching room: match by room code (or name) and campus name
    const matchingRooms = allRooms.filter((r) => {
      const codeMatch =
        r.code.toUpperCase() === slot.roomCode!.toUpperCase() ||
        r.name.toUpperCase() === slot.roomCode!.toUpperCase();

      if (!slot.campusName) return codeMatch;

      const campusMatch =
        r.campus.name.toUpperCase().includes(slot.campusName!.toUpperCase()) ||
        r.campus.code.toUpperCase() === slot.campusName!.toUpperCase() ||
        slot.campusName!.toUpperCase().includes(r.campus.name.toUpperCase());

      return codeMatch && campusMatch;
    });

    if (matchingRooms.length === 0) {
      unmatchedSlots.push({
        slot,
        reason: `Room "${slot.roomCode}"${slot.campusName ? ` on campus "${slot.campusName}"` : ""} not found in the system.`,
      });
      continue;
    }

    const room = matchingRooms[0];
    matchedSlots.push({
      ...slot,
      roomId: room.id,
      campusId: room.campusId,
      roomName: room.name,
      campusDisplayName: room.campus.name,
    });
  }

  // Process matched slots: create reservations, handle conflicts
  const result = await prisma.$transaction(async (tx) => {
    let batchId = "preview";
    if (!isPreview) {
      const batch = await tx.importBatch.create({
        data: {
          fileName: file.name,
          importedById: user.id,
          madeRecurringAt: new Date(),
          recurrenceEndDate,
        },
      });
      batchId = batch.id;
    }

    const created: {
      id: string;
      dayName: string;
      startTime: string;
      endTime: string;
      description: string;
      roomName: string;
      campusName: string;
      firstOccurrence: string;
      hasConflict?: boolean;
      conflictTicketId?: string | null;
      conflictManualReservationId?: string | null;
    }[] = [];
    const warnings: string[] = [];
    const declinedPending: string[] = [];

    for (const slot of matchedSlots) {
      // Calculate the first occurrence
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const todayDow = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
      let daysUntil = slot.dayOfWeek - todayDow;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0) daysUntil = 7;

      const firstDate = new Date(today);
      firstDate.setUTCDate(firstDate.getUTCDate() + daysUntil);

      const startAt = new Date(Date.UTC(
        firstDate.getUTCFullYear(),
        firstDate.getUTCMonth(),
        firstDate.getUTCDate(),
        slot.startHour,
        slot.startMinute
      ));
      const endAt = new Date(Date.UTC(
        firstDate.getUTCFullYear(),
        firstDate.getUTCMonth(),
        firstDate.getUTCDate(),
        slot.endHour,
        slot.endMinute
      ));

      const desc = description?.trim()
        ? `${description.trim()} — ${slot.description}`
        : slot.description;

      // Check for already-approved reservations that conflict
      const approvedConflictCandidates = await tx.reservation.findMany({
        where: {
          roomId: slot.roomId,
          status: "APPROVED",
          OR: [
            // Non-recurring conflicts within this imported series date range
            {
              isRecurring: false,
              startAt: { lte: recurrenceEndDate },
              endAt: { gte: startAt },
            },
            // Recurring candidates with overlapping active series windows
            {
              isRecurring: true,
              startAt: { lte: recurrenceEndDate },
              OR: [
                { recurrenceEndDate: null },
                { recurrenceEndDate: { gte: startAt } },
              ],
            },
          ],
        },
        include: {
          createdBy: { select: { fullName: true } },
          createdFromRequest: { select: { ticketId: true } },
          approvedByRequest: { select: { ticketId: true } },
        },
      });

      let hasConflict = false;
      let conflictTicketId: string | null = null;
      let conflictManualReservationId: string | null = null;
      const approvedConflicts = approvedConflictCandidates.filter((candidate) =>
        reservationConflictsWithImportedSeries(candidate, startAt, endAt, recurrenceEndDate)
      );

      if (approvedConflicts.length > 0) {
        hasConflict = true;
        for (const conflict of approvedConflicts) {
          const linkedTicketId = conflict.createdFromRequest?.ticketId ?? conflict.approvedByRequest?.ticketId;
          if (!conflictTicketId && linkedTicketId) {
            conflictTicketId = linkedTicketId;
          }
          if (!conflictManualReservationId && conflict.kind === "MANUAL") {
            conflictManualReservationId = conflict.id;
          }
          warnings.push(
            `⚠️ ${slot.dayName} ${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")} in ${slot.roomName} (${slot.campusDisplayName}): slot already approved — "${conflict.description}" by ${conflict.createdBy?.fullName ?? "Unknown"}`
          );
        }
      }

      // Auto-decline any PENDING reservation requests that conflict
      const pendingConflicts = await tx.reservationRequest.findMany({
        where: {
          roomId: slot.roomId,
          status: "PENDING",
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        include: { ticket: { select: { id: true, description: true } } },
      });

      for (const pending of pendingConflicts) {
        if (!isPreview) {
          await tx.reservationRequest.update({
            where: { id: pending.id },
            data: {
              status: "DECLINED",
              adminNote: "Auto-declined: slot taken by timetable import.",
            },
          });
          await tx.ticket.update({
            where: { id: pending.ticketId },
            data: { status: "DECLINED" },
          });
          await tx.ticketHistory.create({
            data: {
              ticketId: pending.ticketId,
              action: "STATUS_CHANGED",
              performedById: user.id,
              oldStatus: "NEW",
              newStatus: "DECLINED",
            },
          });
        }
        declinedPending.push(
          `Declined pending request on ${slot.dayName} ${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")} in ${slot.roomName}: "${pending.ticket.description}"`
        );
      }

      let reservationId = `preview-${created.length}`;
      if (!isPreview) {
        // Create the reservation
        const reservation = await tx.reservation.create({
          data: {
            kind: "STANDARD_SCHEDULE",
            status: "APPROVED",
            roomId: slot.roomId,
            campusId: slot.campusId,
            startAt,
            endAt,
            description: desc,
            isRecurring: true,
            recurrenceEndDate,
            importBatchId: batchId,
            createdById: user.id,
          },
        });
        reservationId = reservation.id;
      }

      created.push({
        id: reservationId,
        dayName: slot.dayName,
        startTime: `${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")}`,
        endTime: `${String(slot.endHour).padStart(2, "0")}:${String(slot.endMinute).padStart(2, "0")}`,
        description: desc,
        roomName: slot.roomName,
        campusName: slot.campusDisplayName,
        firstOccurrence: startAt.toISOString(),
        hasConflict,
        conflictTicketId,
        conflictManualReservationId,
      });
    }

    return { batchId, count: created.length, isPreview, reservations: created, warnings, declinedPending, unmatched: unmatchedSlots.map((u) => ({ reason: u.reason, dayName: u.slot.dayName, time: `${String(u.slot.startHour).padStart(2, "0")}:${String(u.slot.startMinute).padStart(2, "0")}`, description: u.slot.description })) };
  });

  return NextResponse.json(result, { status: 201 });
}
