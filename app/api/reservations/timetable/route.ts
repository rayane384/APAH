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
};

/** Parse times like "08H30" or "10H00" into { hour, minute } */
function parseTime(raw: string): { hour: number; minute: number } | null {
  const m = raw.trim().toUpperCase().match(/^(\d{1,2})H(\d{2})$/);
  if (!m) return null;
  return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
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

/**
 * Parse the timetable Excel file.
 * Format (from screenshot):
 * - One row has time headers (cells matching XXH XX pattern)
 * - Sessions are defined by pairs of time cells (start, end)
 * - Day names appear in the leftmost cells (LUNDI..SAMEDI)
 * - Occupied cells contain: subject name on one line, room+campus info on another
 *   where room+campus is formatted as "ROOM_CODE (CAMPUS_NAME)"
 */
function parseTimetable(buffer: Buffer): ParsedSlot[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  // Convert to array of arrays
  const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  if (rows.length < 3) return [];

  // Step 1: Find the time header row
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

  // Step 2: Scan for day names and extract slot content (including room/campus info)
  const slots: ParsedSlot[] = [];

  for (let r = timeRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    let dayOfWeek = -1;
    let dayName = "";
    for (let c = 0; c < Math.min(3, row.length); c++) {
      const cell = String(row[c] ?? "").trim().toUpperCase();
      if (DAY_MAP[cell] !== undefined) {
        dayOfWeek = DAY_MAP[cell];
        dayName = cell;
        break;
      }
    }

    if (dayOfWeek === -1) continue;

    // Collect rows belonging to this day (until next day name)
    const dayRows: (string | number | null)[][] = [row];
    for (let nr = r + 1; nr < Math.min(r + 5, rows.length); nr++) {
      const nextRow = rows[nr];
      if (!nextRow) break;
      let isNewDay = false;
      for (let c = 0; c < Math.min(3, nextRow.length); c++) {
        const cell = String(nextRow[c] ?? "").trim().toUpperCase();
        if (DAY_MAP[cell] !== undefined) {
          isNewDay = true;
          break;
        }
      }
      if (isNewDay) break;
      dayRows.push(nextRow);
    }

    // For each session column, collect content
    for (const session of sessions) {
      const textParts: string[] = [];
      let roomCode: string | null = null;
      let campusName: string | null = null;

      for (const dr of dayRows) {
        for (let sc = session.col; sc <= session.col + 1 && sc < dr.length; sc++) {
          const cell = String(dr[sc] ?? "").trim();
          if (!cell || parseTime(cell)) continue;

          // Try to extract room + campus from this cell
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
          dayOfWeek,
          dayName,
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
      { error: "Could not parse any time slots from the timetable. Make sure it follows the expected format with LUNDI-SAMEDI rows and time headers like 08H30." },
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
    const batch = await tx.importBatch.create({
      data: {
        fileName: file.name,
        importedById: user.id,
        madeRecurringAt: new Date(),
        recurrenceEndDate,
      },
    });

    const created: {
      id: string;
      dayName: string;
      startTime: string;
      endTime: string;
      description: string;
      roomName: string;
      campusName: string;
      firstOccurrence: string;
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
        slot.startMinute,
      ));
      const endAt = new Date(Date.UTC(
        firstDate.getUTCFullYear(),
        firstDate.getUTCMonth(),
        firstDate.getUTCDate(),
        slot.endHour,
        slot.endMinute,
      ));

      const desc = description?.trim()
        ? `${description.trim()} — ${slot.description}`
        : slot.description;

      // Check for already-approved reservations that conflict
      const approvedConflicts = await tx.reservation.findMany({
        where: {
          roomId: slot.roomId,
          status: "APPROVED",
          OR: [
            // Non-recurring conflicts on this specific time
            {
              isRecurring: false,
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
            // Recurring conflicts on the same day/time
            {
              isRecurring: true,
              startAt: { lte: endAt },
              OR: [
                { recurrenceEndDate: null },
                { recurrenceEndDate: { gte: startAt } },
              ],
            },
          ],
        },
        include: { createdBy: { select: { fullName: true } } },
      });

      if (approvedConflicts.length > 0) {
        for (const conflict of approvedConflicts) {
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
        declinedPending.push(
          `Declined pending request on ${slot.dayName} ${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")} in ${slot.roomName}: "${pending.ticket.description}"`
        );
      }

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
          importBatchId: batch.id,
          createdById: user.id,
        },
      });

      created.push({
        id: reservation.id,
        dayName: slot.dayName,
        startTime: `${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")}`,
        endTime: `${String(slot.endHour).padStart(2, "0")}:${String(slot.endMinute).padStart(2, "0")}`,
        description: desc,
        roomName: slot.roomName,
        campusName: slot.campusDisplayName,
        firstOccurrence: startAt.toISOString(),
      });
    }

    return { batchId: batch.id, count: created.length, reservations: created, warnings, declinedPending, unmatched: unmatchedSlots.map((u) => ({ reason: u.reason, dayName: u.slot.dayName, time: `${String(u.slot.startHour).padStart(2, "0")}:${String(u.slot.startMinute).padStart(2, "0")}`, description: u.slot.description })) };
  });

  return NextResponse.json(result, { status: 201 });
}
