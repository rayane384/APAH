"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Campus = { id: string; name: string; code: string };
type RoomType = { id: string; name: string; code: string } | null;

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

type OverrideConflict = {
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

type ManualReservation = {
  id: string;
  status: "APPROVED" | "CANCELLED";
  kind: "MANUAL";
  description: string;
  isRecurring: boolean;
  startAt: string;
  endAt: string;
  recurrenceEndDate: string | null;
  createdAt: string;
  updatedAt: string;
  canAct: boolean;
  occurrenceCount: number | null;
  room: {
    id: string;
    name: string;
    code: string;
    campus: Campus;
    roomType: RoomType;
  };
  createdBy: { id: string; fullName: string; email: string } | null;
  importBatch: {
    id: string;
    fileName: string;
    createdAt: string;
    recurrenceEndDate: string | null;
    importedBy: { id: string; fullName: string; email: string };
  } | null;
};

function formatDateTimeUTC(iso: string) {
  const d = new Date(iso);
  return `${d.toISOString().split("T")[0]} ${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function formatTimeUTC(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function toDateInputValue(iso: string) {
  return iso.split("T")[0];
}

const START_TIME_OPTIONS = Array.from({ length: 37 }, (_, i) => {
  const totalMinutes = 8 * 60 + 30 + i * 15;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
});

export default function ManualReservationHistoryDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data: session } = useSession();

  const isAdmin = session?.user?.role === "ADMIN" && session?.user?.isReservationAdmin;

  const [item, setItem] = useState<ManualReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const [cancelScope, setCancelScope] = useState<"single" | "all">("all");
  const [cancelOccurrenceDate, setCancelOccurrenceDate] = useState("");
  const [overrideScope, setOverrideScope] = useState<"single" | "all">("all");
  const [overrideOccurrenceDate, setOverrideOccurrenceDate] = useState("");

  const [overrideDate, setOverrideDate] = useState("");
  const [overrideSuggestions, setOverrideSuggestions] = useState<ReservationSuggestion[]>([]);
  const [overrideLoadingSuggestions, setOverrideLoadingSuggestions] = useState(false);
  const [overrideSelectedSuggestion, setOverrideSelectedSuggestion] = useState<ReservationSuggestion | null>(null);
  const [overrideFilterCampusId, setOverrideFilterCampusId] = useState("");
  const [overrideFilterRoomTypeId, setOverrideFilterRoomTypeId] = useState("");
  const [overrideFilterPeriod, setOverrideFilterPeriod] = useState("");
  const [overrideFilterDuration, setOverrideFilterDuration] = useState("120");
  const [overrideFilterStartHour, setOverrideFilterStartHour] = useState("");
  const [overrideIncludeTaken, setOverrideIncludeTaken] = useState(false);
  const [allCampuses, setAllCampuses] = useState<Campus[]>([]);
  const [allRoomTypes, setAllRoomTypes] = useState<RoomType[]>([]);
  const [overrideConflicts, setOverrideConflicts] = useState<OverrideConflict[]>([]);
  const [overrideLoadingConflicts, setOverrideLoadingConflicts] = useState(false);
  const [overrideConflictError, setOverrideConflictError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;

    Promise.all([
      fetch(`/api/reservations/manual-history/${id}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to load reservation.");
        return r.json() as Promise<ManualReservation>;
      }),
      fetch("/api/campuses").then((r) => (r.ok ? r.json() : [] as Campus[])),
      fetch("/api/room-types").then((r) => (r.ok ? r.json() : [] as RoomType[])),
    ])
      .then(([reservation, campuses, roomTypes]) => {
        setItem(reservation);
        setAllCampuses(campuses as Campus[]);
        setAllRoomTypes(roomTypes as RoomType[]);
        setOverrideDate(toDateInputValue(reservation.startAt));
        setCancelOccurrenceDate(toDateInputValue(reservation.startAt));
        setOverrideOccurrenceDate(toDateInputValue(reservation.startAt));
      })
      .catch((e) => setError(e.message || "Failed to load reservation."))
      .finally(() => setLoading(false));
  }, [id, isAdmin]);

  useEffect(() => {
    if (!item?.canAct || !overrideDate) {
      setOverrideSuggestions([]);
      return;
    }

    const controller = new AbortController();

    async function loadOverrideSuggestions() {
      try {
        setOverrideLoadingSuggestions(true);
        const params = new URLSearchParams({ date: overrideDate });
        if (overrideFilterCampusId) params.set("campusId", overrideFilterCampusId);
        if (overrideFilterRoomTypeId) params.set("roomTypeId", overrideFilterRoomTypeId);
        if (overrideFilterPeriod) params.set("period", overrideFilterPeriod);
        if (overrideFilterDuration) params.set("durationMin", overrideFilterDuration);
        if (overrideFilterStartHour) params.set("startTime", overrideFilterStartHour);
        if (overrideIncludeTaken) params.set("includeTaken", "true");

        const res = await fetch(`/api/reservations/suggestions?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setOverrideSuggestions([]);
          return;
        }

        const data: ReservationSuggestion[] = await res.json();
        setOverrideSuggestions(data);
      } catch {
        if (!controller.signal.aborted) {
          setOverrideSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setOverrideLoadingSuggestions(false);
        }
      }
    }

    loadOverrideSuggestions();
    return () => controller.abort();
  }, [
    item?.canAct,
    overrideDate,
    overrideFilterCampusId,
    overrideFilterRoomTypeId,
    overrideFilterPeriod,
    overrideFilterDuration,
    overrideFilterStartHour,
    overrideIncludeTaken,
  ]);

  useEffect(() => {
    if (!item?.canAct || !overrideSelectedSuggestion) {
      setOverrideConflicts([]);
      setOverrideConflictError("");
      return;
    }

    const selectedSuggestion = overrideSelectedSuggestion;
    const currentItem = item;

    const controller = new AbortController();

    async function loadOverrideConflicts() {
      try {
        setOverrideLoadingConflicts(true);
        setOverrideConflictError("");

        const params = new URLSearchParams({
          roomId: selectedSuggestion.roomId,
          startAt: selectedSuggestion.startAt,
          endAt: selectedSuggestion.endAt,
          scope: currentItem.isRecurring ? overrideScope : "all",
        });

        if (currentItem.isRecurring && overrideScope === "single") {
          params.set("occurrenceDate", overrideOccurrenceDate);
        }

        const res = await fetch(
          `/api/reservations/manual-history/${id}/override-conflicts?${params.toString()}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setOverrideConflictError(data.error ?? "Failed to check conflicts.");
          setOverrideConflicts([]);
          return;
        }

        const data = (await res.json()) as { conflicts: OverrideConflict[] };
        setOverrideConflicts(data.conflicts ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setOverrideConflictError("Failed to check conflicts.");
          setOverrideConflicts([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setOverrideLoadingConflicts(false);
        }
      }
    }

    loadOverrideConflicts();
    return () => controller.abort();
  }, [id, item?.canAct, item?.isRecurring, overrideSelectedSuggestion, overrideScope, overrideDate, overrideOccurrenceDate]);

  async function submitAction(e: FormEvent, action: "cancel" | "override") {
    e.preventDefault();
    if (!item) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const payload: Record<string, unknown> = {
        action,
        scope: item.isRecurring
          ? (action === "cancel" ? cancelScope : overrideScope)
          : "all",
      };

      const needsOccurrence = item.isRecurring
        && (action === "cancel" ? cancelScope === "single" : overrideScope === "single");

      if (needsOccurrence) {
        const targetOccurrenceDate = action === "cancel" ? cancelOccurrenceDate : overrideOccurrenceDate;
        if (!targetOccurrenceDate) {
          setError("Please select an occurrence date.");
          setSubmitting(false);
          return;
        }
        payload.occurrenceDate = targetOccurrenceDate;
      }

      if (action === "override") {
        if (!overrideSelectedSuggestion) {
          setError("Please select an available slot to override.");
          setSubmitting(false);
          return;
        }
        if (overrideConflicts.length > 0) {
          setError("Resolve conflicts before overriding this reservation.");
          setSubmitting(false);
          return;
        }
        payload.roomId = overrideSelectedSuggestion.roomId;
        payload.startAt = overrideSelectedSuggestion.startAt;
        payload.endAt = overrideSelectedSuggestion.endAt;
      }

      const res = await fetch(`/api/reservations/manual-history/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }

      setMessage(data.message ?? "Action completed.");

      const refreshed = await fetch(`/api/reservations/manual-history/${item.id}`);
      if (refreshed.ok) {
        const updated = (await refreshed.json()) as ManualReservation;
        setItem(updated);
        const baseDate = toDateInputValue(updated.startAt);
        setCancelScope("all");
        setOverrideScope("all");
        setCancelOccurrenceDate(baseDate);
        setOverrideOccurrenceDate(baseDate);
        setOverrideDate(baseDate);
        setOverrideSelectedSuggestion(null);
        setOverrideConflicts([]);
        setOverrideConflictError("");
      }
    } catch {
      setError("Network error while processing action.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isAdmin) {
    return <div className="alert alert-error">Access Denied. Only Reservation Admins can view this section.</div>;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  if (error && !item) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (!item) {
    return <div className="alert alert-error">Reservation not found.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl">Manual Reservation Record</h2>
          <p className="text-brand-gray-light">Record ID: {item.id}</p>
        </div>
        <Link href="/dashboard/manual-reservation-history" className="btn btn-outline btn-sm">
          Back to History
        </Link>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-brand-gray-light">Room</div>
            <div className="font-semibold">{item.room.name} ({item.room.code})</div>
            <div className="text-sm text-brand-gray-light">{item.room.campus.name}</div>
          </div>
          <div>
            <div className="text-xs text-brand-gray-light">Status</div>
            <span className={`badge ${item.status === "APPROVED" ? "badge-resolved" : "badge-declined"}`}>
              {item.status}
            </span>
          </div>

          <div>
            <div className="text-xs text-brand-gray-light">Timeslot</div>
            <div className="font-medium">{formatDateTimeUTC(item.startAt)} → {formatDateTimeUTC(item.endAt)}</div>
          </div>
          <div>
            <div className="text-xs text-brand-gray-light">Recurrence</div>
            <div className="font-medium">
              {item.isRecurring ? "Weekly recurring" : "Single slot"}
              {item.isRecurring && (
                <span className="text-sm text-brand-gray-light ml-2">
                  ({item.occurrenceCount === null ? "open-ended" : `${item.occurrenceCount} occurrences`})
                </span>
              )}
            </div>
            {item.isRecurring && (
              <div className="text-sm text-brand-gray-light">
                Until {item.recurrenceEndDate ? toDateInputValue(item.recurrenceEndDate) : "No end"}
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <div className="text-xs text-brand-gray-light">Description</div>
            <div className="text-sm">{item.description}</div>
          </div>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!item.canAct ? (
        <div className="alert alert-info">This record is cancelled. No further actions are allowed.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form className="card p-4 space-y-3" onSubmit={(e) => submitAction(e, "cancel")}>
            <h3 className="font-semibold">Cancel</h3>
            {item.isRecurring && (
              <>
                <label className="form-label">Scope</label>
                <select className="form-select" value={cancelScope} onChange={(e) => setCancelScope(e.target.value as "single" | "all")}>
                  <option value="single">Only one recurrence (one day)</option>
                  <option value="all">All recurrences</option>
                </select>
                {cancelScope === "single" && (
                  <>
                    <label className="form-label">Occurrence date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={cancelOccurrenceDate}
                      onChange={(e) => setCancelOccurrenceDate(e.target.value)}
                    />
                  </>
                )}
              </>
            )}
            <button className="btn btn-danger btn-sm" disabled={submitting}>
              {submitting ? "Processing..." : "Cancel Reservation"}
            </button>
          </form>

          <form className="card p-4 space-y-3" onSubmit={(e) => submitAction(e, "override")}>
            <h3 className="font-semibold">Override</h3>

            {item.isRecurring && (
              <>
                <label className="form-label">Scope</label>
                <select
                  className="form-select"
                  value={overrideScope}
                  onChange={(e) => {
                    const nextScope = e.target.value as "single" | "all";
                    setOverrideScope(nextScope);
                    setOverrideSelectedSuggestion(null);
                    setOverrideConflicts([]);
                    setOverrideConflictError("");
                  }}
                >
                  <option value="single">Only one recurrence (one day)</option>
                  <option value="all">All recurrences</option>
                </select>
                {overrideScope === "single" && (
                  <>
                    <label className="form-label">Occurrence to override *</label>
                    <input
                      type="date"
                      className="form-input"
                      value={overrideOccurrenceDate}
                      onChange={(e) => {
                        setOverrideOccurrenceDate(e.target.value);
                        setOverrideSelectedSuggestion(null);
                        setOverrideConflicts([]);
                        setOverrideConflictError("");
                      }}
                      required
                    />
                  </>
                )}
              </>
            )}

            <div>
              <label className="form-label">Reservation Date *</label>
              <input
                className="form-input"
                type="date"
                value={overrideDate}
                onChange={(e) => {
                  setOverrideDate(e.target.value);
                  setOverrideSelectedSuggestion(null);
                  setOverrideConflicts([]);
                  setOverrideConflictError("");
                }}
                required
              />
            </div>

            <h5 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide">Filters (optional)</h5>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="form-label text-xs">Campus</label>
                <select className="form-select" value={overrideFilterCampusId} onChange={(e) => { setOverrideFilterCampusId(e.target.value); setOverrideSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  {allCampuses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label text-xs">Room Type</label>
                <select className="form-select" value={overrideFilterRoomTypeId} onChange={(e) => { setOverrideFilterRoomTypeId(e.target.value); setOverrideSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  {allRoomTypes.filter((rt): rt is NonNullable<RoomType> => !!rt).map((rt) => (
                    <option key={rt.id} value={rt.id}>{rt.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label text-xs">Period</label>
                <select className="form-select" value={overrideFilterPeriod} onChange={(e) => { setOverrideFilterPeriod(e.target.value); setOverrideSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  <option value="BEFORE_MIDDAY">Before Midday</option>
                  <option value="AFTER_MIDDAY">After Midday</option>
                </select>
              </div>
              <div>
                <label className="form-label text-xs">Duration</label>
                <select className="form-select" value={overrideFilterDuration} onChange={(e) => { setOverrideFilterDuration(e.target.value); setOverrideSelectedSuggestion(null); }}>
                  <option value="60">1 hour</option>
                  <option value="75">1.25 hours</option>
                  <option value="90">1.5 hours</option>
                  <option value="105">1.75 hours</option>
                  <option value="120">2 hours</option>
                </select>
              </div>
              <div>
                <label className="form-label text-xs">Start Time</label>
                <select className="form-select" value={overrideFilterStartHour} onChange={(e) => { setOverrideFilterStartHour(e.target.value); setOverrideSelectedSuggestion(null); }}>
                  <option value="">Any</option>
                  {START_TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="manualOverrideIncludeTaken"
                checked={overrideIncludeTaken}
                onChange={(e) => { setOverrideIncludeTaken(e.target.checked); setOverrideSelectedSuggestion(null); }}
                className="w-4 h-4 accent-brand-primary rounded"
              />
              <label htmlFor="manualOverrideIncludeTaken" className="text-sm font-medium cursor-pointer">
                Include Taken Slots
              </label>
            </div>

            <h5 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide">
              Available Slots {overrideLoadingSuggestions && <span className="spinner" style={{ width: "1rem", height: "1rem", borderWidth: "2px", display: "inline-block", verticalAlign: "middle", marginLeft: "0.5rem" }} />}
            </h5>

            {!overrideLoadingSuggestions && overrideDate && overrideSuggestions.length === 0 && (
              <div className="alert alert-info">No available slots found for this date and filters.</div>
            )}

            {overrideSuggestions.length > 0 && (
              <div className="suggestion-grid">
                {overrideSuggestions.map((s, i) => {
                  const isSelected = overrideSelectedSuggestion?.roomId === s.roomId && overrideSelectedSuggestion?.startAt === s.startAt;
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
                      onClick={() => {
                        if (s.isTaken) return;
                        setOverrideSelectedSuggestion(s);
                        setOverrideConflicts([]);
                        setOverrideConflictError("");
                      }}
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

            {overrideSelectedSuggestion && (
              <div className="card card-compact" style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                <h5 className="text-sm font-semibold text-green-800 mb-2">📋 Selected Slot</h5>
                <div className="text-sm text-green-900 space-y-1">
                  <div><strong>Room:</strong> {overrideSelectedSuggestion.roomName} ({overrideSelectedSuggestion.campusName})</div>
                  <div><strong>Date:</strong> {overrideDate}</div>
                  <div><strong>Time:</strong> {formatTimeUTC(overrideSelectedSuggestion.startAt)} – {formatTimeUTC(overrideSelectedSuggestion.endAt)}</div>
                </div>
              </div>
            )}

            {overrideSelectedSuggestion && overrideLoadingConflicts && (
              <div className="alert alert-info">Checking conflicts...</div>
            )}

            {overrideSelectedSuggestion && overrideConflictError && (
              <div className="alert alert-error">{overrideConflictError}</div>
            )}

            {overrideSelectedSuggestion && !overrideLoadingConflicts && overrideConflicts.length > 0 && (
              <div className="alert alert-error">
                <div className="font-semibold mb-2">Conflicts found. Override is blocked until you pick another slot.</div>
                <ul className="space-y-2">
                  {overrideConflicts.map((conflict) => (
                    <li key={`${conflict.reservationId}-${conflict.conflictOccurrenceStart}`}>
                      <div className="text-sm text-brand-gray">{conflict.description}</div>
                      <Link href={conflict.linkHref} className="text-sm text-brand-primary font-medium">
                        {conflict.linkLabel} →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button className="btn btn-warning btn-sm" disabled={submitting || !overrideSelectedSuggestion || overrideLoadingConflicts || overrideConflicts.length > 0}>
              {submitting ? "Processing..." : "Override Reservation"}
            </button>
          </form>
        </div>
      )}

      <div className="flex justify-end">
        <button className="btn btn-outline btn-sm" onClick={() => router.refresh()}>
          Refresh
        </button>
      </div>
    </div>
  );
}
