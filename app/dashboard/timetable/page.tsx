"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

type Campus = { id: string; name: string; code: string };
type RoomType = { id: string; name: string; code: string };
type RoomOption = {
  id: string;
  name: string;
  code: string;
  campus: Campus;
  roomType: RoomType | null;
};

type TimetableReservation = {
  id: string;
  kind: string;
  status: string;
  description: string;
  isRecurring: boolean;
  startAt: string;
  endAt: string;
  createdBy: { id: string; fullName: string } | null;
  ticketId?: string | null;
  manualReservationId?: string | null;
};

type ReservationSuggestion = {
  roomId: string;
  roomName: string;
  roomCode: string;
  campusId: string;
  campusName: string;
  roomTypeId: string | null;
  roomTypeName: string | null;
  startAt: string;
  endAt: string;
  pendingCount: number;
  isTaken?: boolean;
  takenTicketId?: string;
  takenReservationId?: string;
  takenReservationKind?: "MANUAL" | "STANDARD_SCHEDULE";
};

type ManualConflict = {
  conflictOccurrenceStart: string;
  conflictOccurrenceEnd: string;
  description: string;
  kind: "MANUAL" | "STANDARD_SCHEDULE";
  isRecurring: boolean;
  reservationId?: string;
  ticketId?: string;
  linkType?: "ticket" | "manual";
  linkHref?: string;
  linkLabel?: string;
};

type TimetableData = {
  room: {
    id: string;
    name: string;
    code: string;
    campus: Campus;
    roomType: RoomType | null;
  };
  weekStart: string;
  weekEnd: string;
  reservations: TimetableReservation[];
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NUMS = [1, 2, 3, 4, 5, 6]; // Mon=1, …, Sat=6

const TIMETABLE_SESSIONS = [
  { label: "08:30 — 10:30", startMinute: 8 * 60 + 30, endMinute: 10 * 60 + 30 },
  { label: "10:30 — 12:30", startMinute: 10 * 60 + 30, endMinute: 12 * 60 + 30 },
  { label: "12:30 — 14:30", startMinute: 12 * 60 + 30, endMinute: 14 * 60 + 30 },
  { label: "14:30 — 16:30", startMinute: 14 * 60 + 30, endMinute: 16 * 60 + 30 },
  { label: "16:30 — 18:30", startMinute: 16 * 60 + 30, endMinute: 18 * 60 + 30 },
];

const TOTAL_VISIBLE_MINUTES = TIMETABLE_SESSIONS.reduce(
  (sum, session) => sum + (session.endMinute - session.startMinute),
  0
);

function getMonday(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate().toString().padStart(2, "0")}/${(d.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function formatWeekLabel(weekStart: Date) {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 5);
  return `${formatDateShort(weekStart.toISOString())} — ${formatDateShort(end.toISOString())}`;
}

function formatTimeUTC(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const START_TIME_OPTIONS = Array.from({ length: 37 }, (_, i) => {
  const totalMinutes = 8 * 60 + 30 + i * 15;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
});

export default function TimetablePage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN" && session?.user?.isReservationAdmin;

  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [filterCampusId, setFilterCampusId] = useState("");
  const [filterRoomTypeId, setFilterRoomTypeId] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("");

  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
  const [timetable, setTimetable] = useState<TimetableData | null>(null);
  const [loadingTimetable, setLoadingTimetable] = useState(false);

  // Manual reservation (Slot Finder)
  const [showManualCreate, setShowManualCreate] = useState(false);
  const [manualDate, setManualDate] = useState("");
  const [manualFilterCampusId, setManualFilterCampusId] = useState("");
  const [manualFilterRoomTypeId, setManualFilterRoomTypeId] = useState("");
  const [manualFilterPeriod, setManualFilterPeriod] = useState("");
  const [manualFilterDuration, setManualFilterDuration] = useState("120");
  const [manualFilterStartHour, setManualFilterStartHour] = useState("");
  const [manualIncludeTaken, setManualIncludeTaken] = useState(false);
  
  const [manualSuggestions, setManualSuggestions] = useState<ReservationSuggestion[]>([]);
  const [manualLoadingSuggestions, setManualLoadingSuggestions] = useState(false);
  const [manualSelectedSuggestion, setManualSelectedSuggestion] = useState<ReservationSuggestion | null>(null);

  const [manualDescription, setManualDescription] = useState("");
  const [manualIsRecurring, setManualIsRecurring] = useState(false);
  const [manualRecurrenceEndDate, setManualRecurrenceEndDate] = useState("");
  const [manualConflicts, setManualConflicts] = useState<ManualConflict[]>([]);
  const [manualConflictLoading, setManualConflictLoading] = useState(false);
  const [manualConflictError, setManualConflictError] = useState<string | null>(null);

  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualSuccess, setManualSuccess] = useState("");
  const [manualError, setManualError] = useState("");

  // Timetable Mode (Import Excel)
  const [timetableMode, setTimetableMode] = useState(false);
  const [timetableFile, setTimetableFile] = useState<File | null>(null);
  const [timetableRecurrenceEnd, setTimetableRecurrenceEnd] = useState("");
  const [timetableDescription, setTimetableDescription] = useState("");
  const [timetableResult, setTimetableResult] = useState<{
    count: number;
    isPreview?: boolean;
    reservations: { dayName: string; startTime: string; endTime: string; description: string; roomName: string; campusName: string; hasConflict?: boolean; conflictTicketId?: string | null; conflictManualReservationId?: string | null }[];
    warnings: string[];
    declinedPending: string[];
    unmatched: { reason: string; dayName: string; time: string; description: string }[];
  } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/campuses").then((r) => r.json()),
      fetch("/api/room-types").then((r) => r.json()),
    ]).then(([c, rt]) => {
      setCampuses(c);
      setRoomTypes(rt);
    });
  }, []);

  // Load rooms based on filters
  useEffect(() => {
    if (!isAdmin) return;
    setLoadingRooms(true);
    const params = new URLSearchParams();
    if (filterCampusId) params.set("campusId", filterCampusId);
    if (filterRoomTypeId) params.set("roomTypeId", filterRoomTypeId);
    fetch(`/api/rooms?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setRooms(data);
        setLoadingRooms(false);
      })
      .catch(() => setLoadingRooms(false));
  }, [isAdmin, filterCampusId, filterRoomTypeId]);

  // Load timetable
  const fetchTimetable = useCallback(async () => {
    if (!selectedRoomId) {
      setTimetable(null);
      return;
    }
    setLoadingTimetable(true);
    try {
      const res = await fetch(
        `/api/rooms/${selectedRoomId}/timetable?weekStart=${weekStart.toISOString().split("T")[0]}`
      );
      if (res.ok) {
        setTimetable(await res.json());
      }
    } catch {
      /* ignore */
    }
    setLoadingTimetable(false);
  }, [selectedRoomId, weekStart]);

  useEffect(() => {
    fetchTimetable();
  }, [fetchTimetable]);

  // Fetch slot suggestions for manual reservation
  useEffect(() => {
    if (!showManualCreate || !manualDate) {
      setManualSuggestions([]);
      return;
    }

    const controller = new AbortController();

    async function loadManualSuggestions() {
      try {
        setManualLoadingSuggestions(true);
        const params = new URLSearchParams({ date: manualDate });
        if (manualFilterCampusId) params.set("campusId", manualFilterCampusId);
        if (manualFilterRoomTypeId) params.set("roomTypeId", manualFilterRoomTypeId);
        if (manualFilterPeriod) params.set("period", manualFilterPeriod);
        if (manualFilterDuration) params.set("durationMin", manualFilterDuration);
        if (manualFilterStartHour) params.set("startTime", manualFilterStartHour);
        if (manualIncludeTaken) params.set("includeTaken", "true");

        const res = await fetch(`/api/reservations/suggestions?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setManualSuggestions([]);
          return;
        }

        const data: ReservationSuggestion[] = await res.json();
        setManualSuggestions(data);
      } catch {
        if (!controller.signal.aborted) {
          setManualSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setManualLoadingSuggestions(false);
        }
      }
    }

    loadManualSuggestions();
    return () => controller.abort();
  }, [
    showManualCreate,
    manualDate,
    manualFilterCampusId,
    manualFilterRoomTypeId,
    manualFilterPeriod,
    manualFilterDuration,
    manualFilterStartHour,
    manualIncludeTaken,
  ]);

  useEffect(() => {
    if (!showManualCreate || !manualSelectedSuggestion) {
      setManualConflicts([]);
      setManualConflictError(null);
      setManualConflictLoading(false);
      return;
    }

    if (manualIsRecurring && !manualRecurrenceEndDate) {
      setManualConflicts([]);
      setManualConflictLoading(false);
      setManualConflictError("Select a recurrence end date to check conflicts.");
      return;
    }

    const controller = new AbortController();

    async function checkManualConflicts() {
      setManualConflictLoading(true);
      setManualConflictError(null);

      try {
        const params = new URLSearchParams({
          roomId: manualSelectedSuggestion.roomId,
          startAt: manualSelectedSuggestion.startAt,
          endAt: manualSelectedSuggestion.endAt,
          isRecurring: manualIsRecurring ? "true" : "false",
        });

        if (manualIsRecurring && manualRecurrenceEndDate) {
          params.set("recurrenceEndDate", manualRecurrenceEndDate);
        }

        const res = await fetch(`/api/reservations/manual/conflicts?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Failed to check conflicts.");
        }

        setManualConflicts(Array.isArray(data?.conflicts) ? data.conflicts : []);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setManualConflicts([]);
        setManualConflictError(error instanceof Error ? error.message : "Failed to check conflicts.");
      } finally {
        if (!controller.signal.aborted) {
          setManualConflictLoading(false);
        }
      }
    }

    checkManualConflicts();
    return () => controller.abort();
  }, [showManualCreate, manualSelectedSuggestion, manualIsRecurring, manualRecurrenceEndDate]);

  function navigateWeek(direction: number) {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setUTCDate(next.getUTCDate() + direction * 7);
      return next;
    });
  }

  function goToToday() {
    setWeekStart(getMonday(new Date()));
  }

  function toMinutesOfDay(date: Date) {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  function toVisibleMinute(minuteOfDay: number) {
    if (minuteOfDay <= TIMETABLE_SESSIONS[0].startMinute) return 0;

    let elapsed = 0;
    for (const session of TIMETABLE_SESSIONS) {
      if (minuteOfDay <= session.startMinute) {
        return elapsed;
      }
      if (minuteOfDay < session.endMinute) {
        return elapsed + (minuteOfDay - session.startMinute);
      }
      elapsed += session.endMinute - session.startMinute;
    }

    return TOTAL_VISIBLE_MINUTES;
  }

  function getDayReservations(dayIndex: number): TimetableReservation[] {
    if (!timetable) return [];

    return timetable.reservations.filter((r) => {
      const rStart = new Date(r.startAt);
      const rDay = rStart.getUTCDay() === 0 ? 7 : rStart.getUTCDay();
      return rDay === DAY_NUMS[dayIndex];
    });
  }

  function getDaySlotLayouts(dayIndex: number) {
    const dayReservations = getDayReservations(dayIndex);

    const positioned = dayReservations
      .map((reservation) => {
        const start = new Date(reservation.startAt);
        const end = new Date(reservation.endAt);
        const startVisible = toVisibleMinute(toMinutesOfDay(start));
        const endVisible = toVisibleMinute(toMinutesOfDay(end));

        if (endVisible <= startVisible) return null;

        return {
          reservation,
          startVisible,
          endVisible,
        };
      })
      .filter((slot): slot is { reservation: TimetableReservation; startVisible: number; endVisible: number } => !!slot)
      .sort((a, b) => a.startVisible - b.startVisible || a.endVisible - b.endVisible);

    const laneEnds: number[] = [];
    const withLanes = positioned.map((slot) => {
      let lane = laneEnds.findIndex((endVisible) => endVisible <= slot.startVisible);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(slot.endVisible);
      } else {
        laneEnds[lane] = slot.endVisible;
      }

      return {
        ...slot,
        lane,
        leftPct: (slot.startVisible / TOTAL_VISIBLE_MINUTES) * 100,
        widthPct: Math.max(((slot.endVisible - slot.startVisible) / TOTAL_VISIBLE_MINUTES) * 100, 1.5),
      };
    });

    return {
      slots: withLanes,
      laneCount: Math.max(laneEnds.length, 1),
    };
  }

  if (!isAdmin) {
    return (
      <div className="alert alert-error">
        Access Denied. Only Reservation Admins can view the timetable.
      </div>
    );
  }

  async function handleManualReservation(e: React.FormEvent) {
    e.preventDefault();
    setManualError("");
    setManualSuccess("");

    if (!manualSelectedSuggestion) {
      setManualError("Please select a slot.");
      return;
    }

    if (manualConflictLoading) {
      setManualError("Please wait for conflict check to complete.");
      return;
    }

    if (manualConflicts.length > 0) {
      setManualError("Resolve conflicting reservations before creating this reservation.");
      return;
    }

    setManualSubmitting(true);
    try {
      const res = await fetch("/api/reservations/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: manualSelectedSuggestion.roomId,
          startAt: manualSelectedSuggestion.startAt,
          endAt: manualSelectedSuggestion.endAt,
          description: manualDescription.trim() || undefined,
          isRecurring: manualIsRecurring,
          recurrenceEndDate: manualIsRecurring ? manualRecurrenceEndDate : null,
        }),
      });
      if (res.ok) {
        setManualSuccess("Reservation created successfully!");
        setManualDate("");
        setManualDescription("");
        setManualSelectedSuggestion(null);
        setManualConflicts([]);
        setManualConflictError(null);
        // Refresh timetable if viewing same room
        if (manualSelectedSuggestion.roomId === selectedRoomId) fetchTimetable();
      } else {
        const data = await res.json();
        setManualError(data.error ?? "Failed to create reservation.");
      }
    } catch {
      setManualError("Network error.");
    }
    setManualSubmitting(false);
  }

  async function handleTimetableSubmit(e: React.FormEvent, isPreview: boolean = true) {
    e.preventDefault();
    setManualError("");
    setManualSuccess("");

    if (!timetableFile) {
      setManualError("Please upload an Excel timetable file.");
      return;
    }
    if (!timetableRecurrenceEnd) {
      setManualError("Please select when the recurring reservations should end.");
      return;
    }

    setManualSubmitting(true);
    const formData = new FormData();
    formData.append("file", timetableFile);
    formData.append("recurrenceEndDate", timetableRecurrenceEnd);
    formData.append("preview", isPreview ? "true" : "false");
    if (timetableDescription.trim()) {
      formData.append("description", timetableDescription.trim());
    }

    try {
      const res = await fetch("/api/reservations/timetable", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setManualError(data.error ?? "Failed to import timetable.");
        setManualSubmitting(false);
        return;
      }

      const result = await res.json();
      setTimetableResult(result);
      if (!isPreview) {
        setManualSuccess("Timetable imported successfully.");
        setTimetableFile(null);
        setTimetableResult(null);
        if (selectedRoomId) fetchTimetable();
      } else {
        setManualSuccess("Preview generated. Please review conflicts before confirming.");
      }
    } catch {
      setManualError("Failed to import timetable.");
    }
    setManualSubmitting(false);
  }

  return (
    <div>
      {/* Page header */}
      <div className="page-header mb-6">
        <h2 className="text-2xl">📅 Room Timetable</h2>
        <p>View and navigate weekly room schedules</p>
      </div>

      {/* Manual reservation creation */}
      <div className="card mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide">
            ➕ Create Manual Reservation
          </h3>
          <button className="btn btn-outline btn-sm" onClick={() => setShowManualCreate(!showManualCreate)}>
            {showManualCreate ? "Hide" : "Show"}
          </button>
        </div>
        {showManualCreate && (
          <div className="space-y-4 pt-2">
            {/* Tabs for Single/Recurring vs Timetable Import */}
            <div className="flex items-center gap-4 border-b border-gray-200 pb-2 mb-4">
              <button
                className={`text-sm font-semibold pb-1 border-b-2 ${!timetableMode ? "border-brand-primary text-brand-primary" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                onClick={() => setTimetableMode(false)}
              >
                Single / Recurring Slot
              </button>
              <button
                className={`text-sm font-semibold pb-1 border-b-2 ${timetableMode ? "border-brand-primary text-brand-primary" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                onClick={() => setTimetableMode(true)}
              >
                Import Excel Timetable
              </button>
            </div>

            {manualError && <div className="alert alert-error text-sm">{manualError}</div>}
            {manualSuccess && <div className="alert alert-success text-sm">{manualSuccess}</div>}

            {timetableMode ? (
              <div className="space-y-4">
                {timetableResult ? (
                  <div className="card max-w-4xl border border-gray-200">
                    <h4 className="text-lg font-bold mb-2">Import Results</h4>
                    {timetableResult.count > 0 && (
                      <div className="alert alert-success mb-4 text-sm">
                        ✅ {timetableResult.count} slots imported and set to recur weekly.
                      </div>
                    )}
                    {timetableResult.warnings.length > 0 && (
                      <div className="alert alert-error mb-4 text-sm" style={{ background: "#fef3c7", borderColor: "#f59e0b", color: "#92400e" }}>
                        <strong>⚠️ Conflicts with existing approved reservations:</strong>
                        <ul className="mt-1 space-y-1">
                          {timetableResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                    {timetableResult.declinedPending.length > 0 && (
                      <div className="alert alert-info mb-4 text-sm" style={{ background: "#e0f2fe", borderColor: "#0ea5e9", color: "#0c4a6e" }}>
                        <strong>ℹ️ These pending requests were automatically declined:</strong>
                        <ul className="mt-1 space-y-1">
                          {timetableResult.declinedPending.map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      </div>
                    )}
                    {timetableResult.unmatched.length > 0 && (
                      <div className="alert alert-error mb-4 text-sm">
                        <strong>❌ {timetableResult.unmatched.length} slots could not be matched to rooms:</strong>
                        <ul className="mt-1 space-y-1">
                          {timetableResult.unmatched.map((u, i) => (
                            <li key={i}>{u.dayName} {u.time} — {u.description}: {u.reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {timetableResult.isPreview ? (
                      <div>
                        <h5 className="font-semibold text-sm mb-2">Parsed Reservations Review</h5>
                        <div className="overflow-x-auto max-h-96 border border-gray-200 rounded">
                          <table className="table w-full table-compact">
                            <thead className="sticky top-0 bg-gray-50 z-10">
                              <tr>
                                <th>Day</th>
                                <th>Time</th>
                                <th>Room</th>
                                <th>Subject</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {timetableResult.reservations.map((r, i) => (
                                <tr key={i} className={r.hasConflict ? "bg-red-50" : ""}>
                                  <td>{r.dayName}</td>
                                  <td>{r.startTime} - {r.endTime}</td>
                                  <td>{r.roomName} <span className="text-xs text-gray-500">({r.campusName})</span></td>
                                  <td>{r.description}</td>
                                  <td>
                                    {r.hasConflict ? (
                                      <div className="flex flex-col gap-1">
                                        <span className="badge badge-error ml-2 text-xs">Conflict</span>
                                        {r.conflictTicketId && (
                                          <a href={`/dashboard/tickets/${r.conflictTicketId}`} target="_blank" rel="noreferrer" className="text-xs underline text-blue-600 hover:text-blue-800">View Ticket</a>
                                        )}
                                        {r.conflictManualReservationId && (
                                          <a href={`/dashboard/manual-reservation-history/${r.conflictManualReservationId}`} target="_blank" rel="noreferrer" className="text-xs underline text-blue-600 hover:text-blue-800">View Record</a>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="badge badge-success text-xs">Ready</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex items-center gap-3 mt-4">
                          <button className="btn btn-outline btn-sm" onClick={() => { setTimetableResult(null); setManualSuccess(""); }}>
                            Cancel / Re-Validate
                          </button>
                          <button className="btn btn-primary btn-sm" onClick={(e) => handleTimetableSubmit(e, false)} disabled={manualSubmitting}>
                            {manualSubmitting ? "Importing..." : "Confirm & Import"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-outline btn-sm mt-2" onClick={() => { setTimetableResult(null); setTimetableFile(null); setTimetableRecurrenceEnd(""); setManualSuccess(""); }}>
                        Import Another
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 max-w-2xl">
                    <div className="flex justify-between items-end">
                      <div>
                        <label className="form-label text-xs">Timetable File (.xlsx / .xls) *</label>
                        <input
                          className="form-input text-sm"
                          type="file"
                          accept=".xlsx,.xls"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) setTimetableFile(f);
                          }}
                        />
                        {timetableFile && (
                          <p className="form-hint mt-1 text-xs">📎 {timetableFile.name} ({formatFileSize(timetableFile.size)})</p>
                        )}
                      </div>
                      <a href="/api/reservations/timetable/template?v=flat-v2" download className="btn btn-outline btn-sm text-brand-primary border-brand-primary">
                        ⬇️ Download Flat Data Template
                      </a>
                    </div>
                    <div>
                      <label className="form-label text-xs">Recurrence End Date *</label>
                      <input
                        className="form-input text-sm"
                        type="date"
                        value={timetableRecurrenceEnd}
                        onChange={(e) => setTimetableRecurrenceEnd(e.target.value)}
                        required
                        min={new Date().toISOString().split("T")[0]}
                      />
                      <p className="form-hint mt-1 text-xs">
                        Timetable reservations repeat weekly until this date.
                      </p>
                    </div>
                    <div>
                      <label className="form-label text-xs">Description (optional)</label>
                      <input
                        className="form-input text-sm"
                        type="text"
                        placeholder="e.g., 1st Year Schedule 2026"
                        value={timetableDescription}
                        onChange={(e) => setTimetableDescription(e.target.value)}
                      />
                    </div>
                    <div className="pt-2">
                      <button 
                        className="btn btn-primary whitespace-nowrap" 
                        onClick={(e) => handleTimetableSubmit(e, true)}
                        disabled={manualSubmitting || !timetableFile || !timetableRecurrenceEnd}
                      >
                        {manualSubmitting ? "Validating…" : "Preview Timetable"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-2">
              <div className="col-span-2 md:col-span-2">
                <label className="form-label text-xs">Date *</label>
                <input type="date" className="form-input" value={manualDate} onChange={(e) => { setManualDate(e.target.value); setManualSelectedSuggestion(null); }} required />
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="form-label text-xs">Campus</label>
                <select className="form-select" value={manualFilterCampusId} onChange={(e) => { setManualFilterCampusId(e.target.value); setManualSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="form-label text-xs">Room Type</label>
                <select className="form-select" value={manualFilterRoomTypeId} onChange={(e) => { setManualFilterRoomTypeId(e.target.value); setManualSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                </select>
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="form-label text-xs">Period</label>
                <select className="form-select" value={manualFilterPeriod} onChange={(e) => { setManualFilterPeriod(e.target.value); setManualSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  <option value="BEFORE_MIDDAY">Before Midday</option>
                  <option value="AFTER_MIDDAY">After Midday</option>
                </select>
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="form-label text-xs">Duration</label>
                <select className="form-select" value={manualFilterDuration} onChange={(e) => { setManualFilterDuration(e.target.value); setManualSelectedSuggestion(null); }}>
                  <option value="60">1 hour</option>
                  <option value="75">1.25 hours</option>
                  <option value="90">1.5 hours</option>
                  <option value="105">1.75 hours</option>
                  <option value="120">2 hours</option>
                </select>
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="form-label text-xs">Start Time</label>
                <select className="form-select" value={manualFilterStartHour} onChange={(e) => { setManualFilterStartHour(e.target.value); setManualSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  {START_TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="includeTaken"
                checked={manualIncludeTaken}
                onChange={(e) => setManualIncludeTaken(e.target.checked)}
                className="w-4 h-4 accent-brand-primary rounded"
              />
              <label htmlFor="includeTaken" className="text-sm font-medium cursor-pointer">
                Include Taken Slots
              </label>
            </div>

            <h5 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide">
              Available Slots 
              {manualLoadingSuggestions && <span className="spinner" style={{ width: "1rem", height: "1rem", borderWidth: "2px", display: "inline-block", verticalAlign: "middle", marginLeft: "0.5rem" }} />}
            </h5>

            {!manualLoadingSuggestions && manualDate && manualSuggestions.length === 0 && (
              <div className="alert alert-info py-2 text-sm">
                No available slots found for this date and filters.
              </div>
            )}

            {manualSuggestions.length > 0 && (
              <div className="suggestion-grid max-h-60 overflow-y-auto pr-2">
                {manualSuggestions.map((s, i) => {
                  const isSelected = manualSelectedSuggestion?.roomId === s.roomId && manualSelectedSuggestion?.startAt === s.startAt;
                  const takenLinkHref = s.takenTicketId
                    ? `/dashboard/tickets/${s.takenTicketId}`
                    : s.takenReservationKind === "MANUAL" && s.takenReservationId
                      ? `/dashboard/manual-reservation-history/${s.takenReservationId}`
                      : null;
                  const takenLinkLabel = s.takenTicketId
                    ? "View Ticket"
                    : s.takenReservationKind === "MANUAL" && s.takenReservationId
                      ? "View Record"
                      : null;
                  return (
                    <div
                      key={`${s.roomId}-${s.startAt}-${i}`}
                      className={`suggestion-card ${isSelected ? "suggestion-card-selected" : ""} ${s.isTaken ? "opacity-60 cursor-not-allowed bg-red-50" : "cursor-pointer"}`}
                      onClick={() => !s.isTaken && setManualSelectedSuggestion(s)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm">{s.roomName}</span>
                        <span className="badge badge-role text-xs">{s.campusName}</span>
                      </div>
                      <div className="text-sm text-brand-gray-light">
                        {formatTimeUTC(s.startAt)} – {formatTimeUTC(s.endAt)}
                      </div>
                      {s.roomTypeName && (
                        <div className="text-xs text-brand-gray-light mt-0.5">{s.roomTypeName}</div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        {s.isTaken ? (
                          <span className="text-xs text-red-600 font-medium">
                            ❌ Taken (cannot select)
                            {takenLinkHref && takenLinkLabel && (
                              <a
                                href={takenLinkHref}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 underline text-red-700 hover:text-red-900"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {takenLinkLabel}
                              </a>
                            )}
                          </span>
                        ) : s.pendingCount > 0 ? (
                          <span className="pending-badge">⏳ {s.pendingCount} pending</span>
                        ) : (
                          <span className="text-xs text-green-600 font-medium">✓ Available</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {manualSelectedSuggestion && (
              <div className="card card-compact mt-2" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <h5 className="text-sm font-semibold text-green-800 mb-2">📋 Selected Slot</h5>
                <div className="text-sm text-green-900 grid grid-cols-2 gap-2 mb-3">
                  <div><strong>Room:</strong> {manualSelectedSuggestion.roomName} ({manualSelectedSuggestion.campusName})</div>
                  <div><strong>Time:</strong> {formatTimeUTC(manualSelectedSuggestion.startAt)} – {formatTimeUTC(manualSelectedSuggestion.endAt)}</div>
                </div>

                <div className="pt-3 border-t border-green-200">
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={manualIsRecurring}
                      onChange={(e) => setManualIsRecurring(e.target.checked)}
                      className="w-4 h-4 accent-green-600 rounded"
                    />
                    <span className="text-sm font-semibold text-green-900">
                      Weekly Recurring Reservation?
                    </span>
                  </label>

                  {manualIsRecurring && (
                    <div className="pl-6">
                      <label className="text-xs font-medium text-green-800">Recurrence End Date *</label>
                      <input
                        className="form-input text-sm border-green-300 focus:border-green-500 focus:ring-green-500 bg-white"
                        type="date"
                        value={manualRecurrenceEndDate}
                        onChange={(e) => setManualRecurrenceEndDate(e.target.value)}
                        required={manualIsRecurring}
                        min={new Date().toISOString().split("T")[0]}
                      />
                      <p className="form-hint text-xs mt-1 text-green-700">This slot will be reserved every week until this date.</p>
                    </div>
                  )}

                  <div className="mt-3 pl-6 space-y-2">
                    <div className="text-xs font-semibold text-green-900">Conflicts</div>
                    {manualConflictLoading ? (
                      <div className="alert py-2 text-xs">Checking conflicts…</div>
                    ) : manualConflictError ? (
                      <div className="alert alert-warning py-2 text-xs">{manualConflictError}</div>
                    ) : manualConflicts.length > 0 ? (
                      <div className="space-y-2">
                        {manualConflicts.map((conflict, i) => (
                          <div key={`${conflict.reservationId ?? "conflict"}-${conflict.conflictOccurrenceStart ?? i}`} className="alert alert-error py-2 text-xs flex flex-col items-start gap-1">
                            <span className="opacity-80">{conflict.description}</span>
                            {conflict.linkHref ? (
                              <a href={conflict.linkHref} target="_blank" rel="noreferrer" className="link link-primary">
                                {conflict.linkLabel ?? "Open related record"}
                              </a>
                            ) : (
                              <span>No linked ticket or manual record found.</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="alert alert-success py-2 text-xs">No conflicts found.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 w-full relative">
                <label className="form-label text-xs">Description (optional)</label>
                <input type="text" className="form-input" placeholder="e.g., Lab session, Exam, Meeting…" value={manualDescription} onChange={(e) => setManualDescription(e.target.value)} />
              </div>
              <button 
                className="btn btn-primary whitespace-nowrap" 
                onClick={handleManualReservation}
                disabled={manualSubmitting || !manualSelectedSuggestion || manualConflictLoading || manualConflicts.length > 0}
              >
                {manualSubmitting ? "Creating…" : "Create Reservation"}
              </button>
            </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Room selection */}
      <div className="card mb-5">
        <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">
          Select Room
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="form-label text-xs">Campus</label>
            <select
              className="form-select"
              value={filterCampusId}
              onChange={(e) => { setFilterCampusId(e.target.value); setSelectedRoomId(""); }}
            >
              <option value="">All Campuses</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label text-xs">Room Type</label>
            <select
              className="form-select"
              value={filterRoomTypeId}
              onChange={(e) => { setFilterRoomTypeId(e.target.value); setSelectedRoomId(""); }}
            >
              <option value="">All Types</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label text-xs">Room</label>
            <select
              className="form-select"
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
            >
              <option value="">— Select a room —</option>
              {loadingRooms ? (
                <option disabled>Loading…</option>
              ) : (
                rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.campus.name}{r.roomType ? ` (${r.roomType.name})` : ""}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Room quick navigation: next/prev room */}
        {rooms.length > 0 && selectedRoomId && (
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                const idx = rooms.findIndex((r) => r.id === selectedRoomId);
                if (idx > 0) setSelectedRoomId(rooms[idx - 1].id);
              }}
              disabled={rooms.findIndex((r) => r.id === selectedRoomId) <= 0}
            >
              ← Prev Room
            </button>
            <span className="text-sm text-brand-gray-light">
              {rooms.findIndex((r) => r.id === selectedRoomId) + 1} / {rooms.length}
            </span>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                const idx = rooms.findIndex((r) => r.id === selectedRoomId);
                if (idx < rooms.length - 1) setSelectedRoomId(rooms[idx + 1].id);
              }}
              disabled={rooms.findIndex((r) => r.id === selectedRoomId) >= rooms.length - 1}
            >
              Next Room →
            </button>
          </div>
        )}
      </div>

      {/* Week navigation */}
      {selectedRoomId && (
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button className="btn btn-outline btn-sm" onClick={() => navigateWeek(-1)}>
              ← Previous
            </button>
            <button className="btn btn-outline btn-sm" onClick={goToToday}>
              Today
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => navigateWeek(1)}>
              Next →
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>
              {formatWeekLabel(weekStart)}
            </span>
            <input
              type="date"
              className="form-input"
              style={{ width: "auto" }}
              value={weekStart.toISOString().split("T")[0]}
              onChange={(e) => {
                if (e.target.value) setWeekStart(getMonday(new Date(e.target.value + "T00:00:00Z")));
              }}
            />
          </div>
          {timetable && (
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded" style={{ background: "var(--brand-primary)", border: "2px solid var(--brand-primary-dark)" }} />
                Recurring
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded" style={{ background: "#7c3aed" }} />
                One-time
              </span>
            </div>
          )}
        </div>
      )}

      {/* Timetable header */}
      {selectedRoomId && timetable && (
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-lg font-bold">{timetable.room.name}</h3>
          <span className="badge badge-role">{timetable.room.campus.name}</span>
          {timetable.room.roomType && (
            <span className="badge" style={{ background: "#e0e7ff", color: "#3730a3" }}>
              {timetable.room.roomType.name}
            </span>
          )}
        </div>
      )}

      {/* Loading */}
      {loadingTimetable && (
        <div className="flex justify-center py-12">
          <div className="spinner" />
        </div>
      )}

      {/* No room selected */}
      {!selectedRoomId && (
        <div className="alert alert-info">
          Select a room above to view its timetable.
        </div>
      )}

      {/* Timetable grid */}
      {selectedRoomId && timetable && !loadingTimetable && (
        <div className="timetable-container">
          <div className="timetable-grid">
            {/* Header row: empty corner + time slot headers */}
            <div className="timetable-corner" />
            {TIMETABLE_SESSIONS.map((session) => (
              <div key={session.label} className="timetable-header">
                {session.label}
              </div>
            ))}

            {/* Day rows */}
            {DAYS.map((day, dayIdx) => {
              const dayDate = new Date(weekStart);
              dayDate.setUTCDate(dayDate.getUTCDate() + dayIdx);
              const dayLayouts = getDaySlotLayouts(dayIdx);

              return (
                <div key={`day-col-${dayIdx}`} className="contents">
                  <div className="timetable-day">
                    <div className="timetable-day-name">{day}</div>
                    <div className="timetable-day-date">{formatDateShort(dayDate.toISOString())}</div>
                  </div>
                  <div className="timetable-day-track" style={{ minHeight: `${dayLayouts.laneCount * 76 + 8}px` }}>
                    <div className="timetable-track-grid" aria-hidden>
                      {TIMETABLE_SESSIONS.map((session) => (
                        <div key={`${dayIdx}-${session.label}`} className="timetable-track-segment" />
                      ))}
                    </div>
                    {dayLayouts.slots.map((slot) => {
                      const r = slot.reservation;
                      const sourceHref = r.ticketId
                        ? `/dashboard/tickets/${r.ticketId}`
                        : r.manualReservationId
                          ? `/dashboard/manual-reservation-history/${r.manualReservationId}`
                          : null;
                      const isPressable = !!sourceHref && r.kind !== "STANDARD_SCHEDULE";
                      return (
                        <div
                          key={r.id + r.startAt}
                          className={`timetable-slot timetable-slot-absolute ${r.isRecurring ? "timetable-slot-recurring" : "timetable-slot-onetime"} ${isPressable ? "cursor-pointer" : ""}`}
                          style={{
                            left: `${slot.leftPct}%`,
                            width: `${slot.widthPct}%`,
                            top: `${slot.lane * 76 + 4}px`,
                          }}
                          title={`${r.description}\n${formatTimeUTC(r.startAt)} — ${formatTimeUTC(r.endAt)}\n${r.isRecurring ? "🔁 Recurring" : "One-time"}`}
                          onClick={() => {
                            if (isPressable && sourceHref) {
                              window.open(sourceHref, "_blank", "noopener,noreferrer");
                            }
                          }}
                        >
                          <div className="timetable-slot-time">
                            {formatTimeUTC(r.startAt)} — {formatTimeUTC(r.endAt)}
                          </div>
                          <div className="timetable-slot-desc">{r.description}</div>
                          <div className="timetable-slot-meta">
                            {r.isRecurring && <span className="timetable-recurring-icon">🔁</span>}
                            {r.createdBy && <span>{r.createdBy.fullName}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No reservations message */}
      {selectedRoomId && timetable && !loadingTimetable && timetable.reservations.length === 0 && (
        <div className="alert alert-info mt-4">
          No reservations found for this room during the selected week.
        </div>
      )}
    </div>
  );
}
