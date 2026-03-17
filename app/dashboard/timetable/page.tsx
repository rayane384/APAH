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

const TIME_SLOTS = [
  { label: "08:00", startHour: 8 },
  { label: "10:00", startHour: 10 },
  { label: "12:00", startHour: 12 },
  { label: "14:00", startHour: 14 },
  { label: "16:00", startHour: 16 },
  { label: "18:00", startHour: 18 },
];

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

export default function TimetablePage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

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
  
  const [manualSuggestions, setManualSuggestions] = useState<ReservationSuggestion[]>([]);
  const [manualLoadingSuggestions, setManualLoadingSuggestions] = useState(false);
  const [manualSelectedSuggestion, setManualSelectedSuggestion] = useState<ReservationSuggestion | null>(null);

  const [manualDescription, setManualDescription] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualSuccess, setManualSuccess] = useState("");
  const [manualError, setManualError] = useState("");
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
        if (manualFilterStartHour) params.set("startHour", manualFilterStartHour);

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
  ]);

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

  // Get reservations for a specific day + time slot
  function getSlotReservations(dayIndex: number, startHour: number): TimetableReservation[] {
    if (!timetable) return [];
    const slotEnd = startHour + 2;

    return timetable.reservations.filter((r) => {
      const rStart = new Date(r.startAt);
      const rEnd = new Date(r.endAt);
      const rDay = rStart.getUTCDay() === 0 ? 7 : rStart.getUTCDay();
      if (rDay !== DAY_NUMS[dayIndex]) return false;

      const rStartH = rStart.getUTCHours() + rStart.getUTCMinutes() / 60;
      const rEndH = rEnd.getUTCHours() + rEnd.getUTCMinutes() / 60;

      // Overlaps with this 2-hour slot
      return rStartH < slotEnd && rEndH > startHour;
    });
  }

  if (!isAdmin) {
    return (
      <div className="alert alert-error">
        This page is only accessible to admin users.
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
        }),
      });
      if (res.ok) {
        setManualSuccess("Reservation created successfully!");
        setManualDate("");
        setManualDescription("");
        setManualSelectedSuggestion(null);
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
            {manualError && <div className="alert alert-error text-sm">{manualError}</div>}
            {manualSuccess && <div className="alert alert-success text-sm">{manualSuccess}</div>}
            
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-2">
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
                  <option value="90">1.5 hours</option>
                  <option value="120">2 hours</option>
                </select>
              </div>
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
                  return (
                    <div
                      key={`${s.roomId}-${s.startAt}-${i}`}
                      className={`suggestion-card ${isSelected ? "suggestion-card-selected" : ""}`}
                      onClick={() => setManualSelectedSuggestion(s)}
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
                        {s.pendingCount > 0 ? (
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
              <div className="card card-compact mt-2" style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                <h5 className="text-sm font-semibold text-green-800 mb-2">📋 Selected Slot</h5>
                <div className="text-sm text-green-900 grid grid-cols-2 gap-2">
                  <div><strong>Room:</strong> {manualSelectedSuggestion.roomName} ({manualSelectedSuggestion.campusName})</div>
                  <div><strong>Time:</strong> {formatTimeUTC(manualSelectedSuggestion.startAt)} – {formatTimeUTC(manualSelectedSuggestion.endAt)}</div>
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
                disabled={manualSubmitting || !manualSelectedSuggestion}
              >
                {manualSubmitting ? "Creating…" : "Create Reservation"}
              </button>
            </div>
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
            {TIME_SLOTS.map((ts) => (
              <div key={ts.label} className="timetable-header">
                {ts.label} — {ts.startHour + 2}:00
              </div>
            ))}

            {/* Day rows */}
            {DAYS.map((day, dayIdx) => {
              const dayDate = new Date(weekStart);
              dayDate.setUTCDate(dayDate.getUTCDate() + dayIdx);

              return (
                <>
                  <div key={`day-${dayIdx}`} className="timetable-day">
                    <div className="timetable-day-name">{day}</div>
                    <div className="timetable-day-date">{formatDateShort(dayDate.toISOString())}</div>
                  </div>
                  {TIME_SLOTS.map((ts) => {
                    const reservations = getSlotReservations(dayIdx, ts.startHour);
                    return (
                      <div key={`${dayIdx}-${ts.startHour}`} className="timetable-cell">
                        {reservations.map((r) => (
                          <div
                            key={r.id + r.startAt}
                            className={`timetable-slot ${r.isRecurring ? "timetable-slot-recurring" : "timetable-slot-onetime"}`}
                            title={`${r.description}\n${formatTimeUTC(r.startAt)} — ${formatTimeUTC(r.endAt)}\n${r.isRecurring ? "🔁 Recurring" : "One-time"}`}
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
                        ))}
                      </div>
                    );
                  })}
                </>
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
