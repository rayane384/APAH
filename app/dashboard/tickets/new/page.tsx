"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Category = {
  id: string;
  name: string;
  code: string;
  isReservation: boolean;
  isOther: boolean;
  ownerDepartment: { id: string; name: string; code: string };
};

type Department = {
  id: string;
  name: string;
  code: string;
};

type Campus = { id: string; name: string; code: string };
type RoomType = { id: string; name: string; code: string };

type Suggestion = {
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
};

export default function NewTicketPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Standard ticket fields
  const [categoryId, setCategoryId] = useState("");
  const [subtype, setSubtype] = useState("");
  const [description, setDescription] = useState("");
  const [targetDeptId, setTargetDeptId] = useState("");

  // Reservation fields
  const [reservationDate, setReservationDate] = useState("");
  const [filterCampusId, setFilterCampusId] = useState("");
  const [filterRoomTypeId, setFilterRoomTypeId] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterDuration, setFilterDuration] = useState("120");
  const [filterStartHour, setFilterStartHour] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [adminCanAdjust, setAdminCanAdjust] = useState(false);

  // Custom start/duration for >2h slots
  const [customStartHour, setCustomStartHour] = useState("");
  const [customDuration, setCustomDuration] = useState("60");

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isReservation = selectedCategory?.isReservation ?? false;

  // Determine if selected suggestion is >2h
  const selectedDurationHours = selectedSuggestion
    ? (new Date(selectedSuggestion.endAt).getTime() - new Date(selectedSuggestion.startAt).getTime()) / 3600000
    : 0;
  const needsCustomTimes = selectedDurationHours > 2;

  // When admin selects a category, auto-fill from category default
  useEffect(() => {
    if (isAdmin && selectedCategory) {
      setTargetDeptId(selectedCategory.ownerDepartment.id);
    }
  }, [categoryId, isAdmin, selectedCategory]);

  // Load initial data
  useEffect(() => {
    Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      isAdmin ? fetch("/api/departments").then((r) => r.json()) : Promise.resolve([]),
      fetch("/api/campuses").then((r) => r.json()),
      fetch("/api/room-types").then((r) => r.json()),
    ])
      .then(([cats, depts, camps, rts]: [Category[], Department[], Campus[], RoomType[]]) => {
        setCategories(cats);
        setDepartments(depts);
        setCampuses(camps);
        setRoomTypes(rts);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isAdmin]);

  // Reset reservation state when category changes
  useEffect(() => {
    if (!isReservation) {
      setReservationDate("");
      setSuggestions([]);
      setSelectedSuggestion(null);
    }
  }, [isReservation]);

  // Fetch suggestions when date or filters change
  useEffect(() => {
    if (!isReservation || !reservationDate) {
      setSuggestions([]);
      return;
    }
    fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationDate, filterCampusId, filterRoomTypeId, filterPeriod, filterDuration, filterStartHour, isReservation]);

  async function fetchSuggestions() {
    setLoadingSuggestions(true);
    setSelectedSuggestion(null);
    const params = new URLSearchParams({ date: reservationDate });
    if (filterCampusId) params.set("campusId", filterCampusId);
    if (filterRoomTypeId) params.set("roomTypeId", filterRoomTypeId);
    if (filterPeriod) params.set("period", filterPeriod);
    if (filterDuration) params.set("durationMin", filterDuration);
    if (filterStartHour) params.set("startHour", filterStartHour);

    try {
      const res = await fetch(`/api/reservations/suggestions?${params.toString()}`);
      if (res.ok) {
        setSuggestions(await res.json());
      }
    } catch {
      /* ignore */
    }
    setLoadingSuggestions(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!categoryId) {
      setError("Please select a category.");
      return;
    }
    if (!description.trim()) {
      setError("Please enter a description.");
      return;
    }

    // ── Reservation submission ──────────────────────
    if (isReservation) {
      if (!selectedSuggestion) {
        setError("Please select a time slot from the suggestions.");
        return;
      }

      let finalStartAt = selectedSuggestion.startAt;
      let finalEndAt = selectedSuggestion.endAt;

      // If >2h slot, user must provide custom start + duration
      if (needsCustomTimes) {
        if (!customStartHour) {
          setError("For slots longer than 2 hours, you must specify a start time.");
          return;
        }
        const dur = parseInt(customDuration, 10);
        if (!dur || dur < 60 || dur > 120) {
          setError("Duration must be between 60 and 120 minutes.");
          return;
        }
        const baseDate = new Date(selectedSuggestion.startAt);
        const customStart = new Date(Date.UTC(
          baseDate.getUTCFullYear(),
          baseDate.getUTCMonth(),
          baseDate.getUTCDate(),
          parseInt(customStartHour, 10),
          0, 0
        ));
        const customEnd = new Date(customStart.getTime() + dur * 60000);
        finalStartAt = customStart.toISOString();
        finalEndAt = customEnd.toISOString();
      }

      setSubmitting(true);
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          description,
          roomId: selectedSuggestion.roomId,
          startAt: finalStartAt,
          endAt: finalEndAt,
          adminCanAdjust,
          periodOfDay: filterPeriod || "ANY",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create reservation ticket.");
        setSubmitting(false);
        return;
      }

      const ticket = await res.json();
      router.push(`/dashboard/tickets/${ticket.id}`);
      return;
    }

    // ── Standard ticket submission ──────────────────
    setSubmitting(true);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId,
        subtype: subtype || undefined,
        description,
        ...(isAdmin && targetDeptId ? { assignedDepartmentId: targetDeptId } : {}),
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to create ticket.");
      setSubmitting(false);
      return;
    }

    const ticket = await res.json();
    router.push(`/dashboard/tickets/${ticket.id}`);
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="page-header mb-6">
        <h2 className="text-2xl">{isReservation ? "Reserve a Room" : "Create New Ticket"}</h2>
        <p>{isReservation ? "Find and book an available time slot" : "Fill in the details to submit a new ticket"}</p>
      </div>

      <div className={`card ${isReservation ? "max-w-4xl" : "max-w-2xl"}`}>
        {error && (
          <div className="alert alert-error mb-5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Category */}
          <div>
            <label className="form-label">Category *</label>
            <select
              className="form-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              <option value="">— Select a category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.isReservation ? " 🏫" : ""} ({c.ownerDepartment.name})
                </option>
              ))}
            </select>
            {selectedCategory && !isReservation && !isAdmin && (
              <p className="form-hint mt-1">
                Will be sent to: <strong>{selectedCategory.ownerDepartment.name}</strong>
              </p>
            )}
          </div>

          {/* Target Department (admin only, non-reservation) */}
          {isAdmin && !isReservation && (
            <div>
              <label className="form-label">Send to Department *</label>
              <select
                className="form-select"
                value={targetDeptId}
                onChange={(e) => setTargetDeptId(e.target.value)}
                required
              >
                <option value="">— Select a department —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
              {selectedCategory && targetDeptId !== selectedCategory.ownerDepartment.id && (
                <p className="form-hint mt-1 text-amber-600">
                  Note: default for this category is {selectedCategory.ownerDepartment.name}
                </p>
              )}
            </div>
          )}

          {/* Standard ticket: Subtype */}
          {!isReservation && (
            <div>
              <label className="form-label">Sub-type (optional)</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g., Projector, Printer…"
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
              />
            </div>
          )}

          {/* Description (always required) */}
          <div>
            <label className="form-label">Description *</label>
            <textarea
              className="form-textarea"
              rows={isReservation ? 3 : 5}
              placeholder={isReservation ? "Describe the purpose of your reservation…" : "Describe your issue or request…"}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {/* ── Reservation flow ────────────────────────── */}
          {isReservation && (
            <>
              {/* Date picker */}
              <div>
                <label className="form-label">Reservation Date *</label>
                <input
                  className="form-input"
                  type="date"
                  value={reservationDate}
                  onChange={(e) => setReservationDate(e.target.value)}
                  required
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>

              {/* Filters */}
              {reservationDate && (
                <div className="reservation-filters">
                  <h4 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">
                    Filters (optional)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div>
                      <label className="form-label text-xs">Campus</label>
                      <select className="form-select" style={{ fontSize: "0.85rem" }} value={filterCampusId} onChange={(e) => setFilterCampusId(e.target.value)}>
                        <option value="">All</option>
                        {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Room Type</label>
                      <select className="form-select" style={{ fontSize: "0.85rem" }} value={filterRoomTypeId} onChange={(e) => setFilterRoomTypeId(e.target.value)}>
                        <option value="">All</option>
                        {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Period</label>
                      <select className="form-select" style={{ fontSize: "0.85rem" }} value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}>
                        <option value="">Any</option>
                        <option value="BEFORE_MIDDAY">Morning</option>
                        <option value="AFTER_MIDDAY">Afternoon</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Duration</label>
                      <select className="form-select" style={{ fontSize: "0.85rem" }} value={filterDuration} onChange={(e) => setFilterDuration(e.target.value)}>
                        <option value="60">1 hour</option>
                        <option value="90">1.5 hours</option>
                        <option value="120">2 hours</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Start Hour</label>
                      <select className="form-select" style={{ fontSize: "0.85rem" }} value={filterStartHour} onChange={(e) => setFilterStartHour(e.target.value)}>
                        <option value="">Any</option>
                        {Array.from({ length: 10 }, (_, i) => i + 8).map((h) => (
                          <option key={h} value={String(h)}>{h}:00</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {reservationDate && (
                <div>
                  <h4 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">
                    Available Slots {loadingSuggestions && <span className="spinner" style={{ width: "1rem", height: "1rem", borderWidth: "2px", display: "inline-block", verticalAlign: "middle", marginLeft: "0.5rem" }} />}
                  </h4>

                  {!loadingSuggestions && suggestions.length === 0 && (
                    <div className="alert alert-info">
                      No available slots found for this date and filters. Try adjusting your criteria.
                    </div>
                  )}

                  {suggestions.length > 0 && (
                    <div className="suggestion-grid">
                      {suggestions.map((s, i) => {
                        const isSelected = selectedSuggestion?.roomId === s.roomId && selectedSuggestion?.startAt === s.startAt;
                        return (
                          <div
                            key={`${s.roomId}-${s.startAt}-${i}`}
                            className={`suggestion-card ${isSelected ? "suggestion-card-selected" : ""}`}
                            onClick={() => setSelectedSuggestion(s)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">{s.roomName}</span>
                              <span className="badge badge-role text-xs">{s.campusName}</span>
                            </div>
                            <div className="text-sm text-brand-gray-light">
                              {formatTime(s.startAt)} – {formatTime(s.endAt)}
                            </div>
                            {s.roomTypeName && (
                              <div className="text-xs text-brand-gray-light mt-0.5">{s.roomTypeName}</div>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              {s.pendingCount > 0 ? (
                                <span className="pending-badge">
                                  ⏳ {s.pendingCount} pending
                                </span>
                              ) : (
                                <span className="text-xs text-green-600 font-medium">✓ No pending requests</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Custom time for >2h slots */}
              {selectedSuggestion && needsCustomTimes && (
                <div className="card" style={{ background: "#fffbf0", borderColor: "#f0d78c" }}>
                  <p className="text-sm text-amber-800 mb-3">
                    ⚠️ The selected slot is longer than 2 hours. Please specify your desired start time and duration.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label text-xs">Start Hour *</label>
                      <select className="form-select" value={customStartHour} onChange={(e) => setCustomStartHour(e.target.value)} required>
                        <option value="">Select…</option>
                        {Array.from({ length: Math.floor(selectedDurationHours) }, (_, i) => {
                          const baseHour = new Date(selectedSuggestion.startAt).getUTCHours();
                          return baseHour + i;
                        }).map((h) => (
                          <option key={h} value={String(h)}>{h}:00</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Duration *</label>
                      <select className="form-select" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)} required>
                        <option value="60">1 hour</option>
                        <option value="90">1.5 hours</option>
                        <option value="120">2 hours</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Flexibility toggle */}
              {selectedSuggestion && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adminCanAdjust}
                      onChange={(e) => setAdminCanAdjust(e.target.checked)}
                      className="w-4 h-4 accent-brand rounded"
                    />
                    <span className="text-sm">
                      Allow admin to modify campus, room or time (not period) if needed
                    </span>
                  </label>
                </div>
              )}

              {/* Selected summary */}
              {selectedSuggestion && (
                <div className="card card-compact" style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                  <h4 className="text-sm font-semibold text-green-800 mb-2">📋 Selected Reservation</h4>
                  <div className="text-sm text-green-900 space-y-1">
                    <div><strong>Room:</strong> {selectedSuggestion.roomName} ({selectedSuggestion.campusName})</div>
                    <div><strong>Date:</strong> {reservationDate}</div>
                    <div><strong>Time:</strong> {formatTime(selectedSuggestion.startAt)} – {formatTime(selectedSuggestion.endAt)}</div>
                    {selectedSuggestion.roomTypeName && (
                      <div><strong>Type:</strong> {selectedSuggestion.roomTypeName}</div>
                    )}
                    {adminCanAdjust && (
                      <div className="text-xs text-green-700 mt-1">🔄 Admin can adjust campus, room or time (not period)</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={submitting || (isReservation && !selectedSuggestion)}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="spinner" style={{ width: "1rem", height: "1rem", borderWidth: "2px" }} />
                  Creating…
                </span>
              ) : isReservation ? (
                "Submit Reservation"
              ) : (
                "Submit Ticket"
              )}
            </button>
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => router.push("/dashboard/tickets")}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
