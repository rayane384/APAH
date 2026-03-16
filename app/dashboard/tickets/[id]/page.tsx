"use client";

import { useEffect, useState, FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    fullName: string;
    role: string;
    department?: { id: string; name: string; code: string } | null;
  };
};

type Department = { id: string; name: string; code: string };
type Campus = { id: string; name: string; code: string };
type RoomType = { id: string; name: string; code: string };

type ReservationSuggestion = {
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

type HistoryEntry = {
  id: string;
  action: "PICKED" | "UNPICKED" | "ROUTED" | "STATUS_CHANGED";
  performedBy: { id: string; fullName: string };
  oldStatus: string | null;
  newStatus: string | null;
  fromDepartmentId: string | null;
  toDepartmentId: string | null;
  createdAt: string;
};

type ReservationRequestData = {
  id: string;
  status: string;
  roomId: string;
  campusId: string;
  startAt: string;
  endAt: string;
  adminCanAdjust: boolean;
  periodOfDay: string;
  adminNote: string | null;
  processedAt: string | null;
  room: {
    id: string;
    name: string;
    code: string;
    capacity: number | null;
    campus: Campus;
    roomType: RoomType | null;
  };
  campus: Campus;
  approvedReservation: {
    id: string;
    status: string;
    startAt: string;
    endAt: string;
    description: string;
  } | null;
};

type Conflict = {
  requestId: string;
  ticketId: string;
  description: string;
  ticketStatus: string;
  createdBy: { id: string; fullName: string; email: string };
  roomName: string;
  roomCode: string;
  campusName: string;
  startAt: string;
  endAt: string;
  adminCanAdjust: boolean;
};

type Ticket = {
  id: string;
  subtype: string | null;
  description: string;
  status: string;
  priority: string | null;
  aiReason: string | null;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; code: string; isReservation: boolean; isOther: boolean };
  createdBy: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    profile: string | null;
    department?: { id: string; name: string; code: string } | null;
  };
  assignedDepartment: { id: string; name: string; code: string };
  assignedTo: { id: string; fullName: string; email: string } | null;
  routedTo: { id: string; assignedDepartment: { id: string; name: string; code: string } } | null;
  routedFrom: { id: string; assignedDepartment: { id: string; name: string; code: string } } | null;
  comments: Comment[];
  reservationRequest: ReservationRequestData | null;
};

const STATUS_BADGE: Record<string, string> = {
  NEW: "badge-new",
  IN_PROGRESS: "badge-in-progress",
  RESOLVED: "badge-resolved",
  DECLINED: "badge-declined",
};

const RR_STATUS_BADGE: Record<string, string> = {
  PENDING: "badge-new",
  ACCEPTED: "badge-resolved",
  DECLINED: "badge-declined",
  OVERRIDDEN: "badge-in-progress",
  CANCELLED: "badge-declined",
};

/* Status workflow: valid transitions (mirrors API) */
const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "DECLINED"],
  RESOLVED: [],
  DECLINED: [],
};

const ALL_STATUSES = ["NEW", "IN_PROGRESS", "RESOLVED", "DECLINED"];

/* History action labels & icons */
const HISTORY_META: Record<string, { icon: string; label: string }> = {
  PICKED: { icon: "📋", label: "Picked" },
  UNPICKED: { icon: "↩️", label: "Released" },
  ROUTED: { icon: "🔀", label: "Routed" },
  STATUS_CHANGED: { icon: "🔄", label: "Status changed" },
};

function formatTimeUTC(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

function formatDateUTC(iso: string) {
  const d = new Date(iso);
  return d.toISOString().split("T")[0];
}

export default function TicketDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data: session } = useSession();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Standard ticket state
  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [picking, setPicking] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routeDeptId, setRouteDeptId] = useState("");
  const [showRouteForm, setShowRouteForm] = useState(false);

  // Reservation admin state
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [processingReservation, setProcessingReservation] = useState(false);

  // Override fields
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideSuggestions, setOverrideSuggestions] = useState<ReservationSuggestion[]>([]);
  const [overrideLoadingSuggestions, setOverrideLoadingSuggestions] = useState(false);
  const [overrideSelectedSuggestion, setOverrideSelectedSuggestion] = useState<ReservationSuggestion | null>(null);
  const [overrideFilterCampusId, setOverrideFilterCampusId] = useState("");
  const [overrideFilterRoomTypeId, setOverrideFilterRoomTypeId] = useState("");
  const [overrideFilterPeriod, setOverrideFilterPeriod] = useState("");
  const [overrideFilterDuration, setOverrideFilterDuration] = useState("120");
  const [overrideFilterStartHour, setOverrideFilterStartHour] = useState("");
  const [allCampuses, setAllCampuses] = useState<Campus[]>([]);
  const [allRoomTypes, setAllRoomTypes] = useState<RoomType[]>([]);

  const user = session?.user;
  const isAdminUser = user?.role === "ADMIN";
  const isDeptAdmin =
    isAdminUser && ticket?.assignedDepartment?.id === user?.departmentId;
  const isPickedByMe = ticket?.assignedTo?.id === user?.id;
  const isTicketPicked = !!ticket?.assignedTo;
  const isCreator = ticket?.createdBy?.id === user?.id;
  const isTriage =
    isDeptAdmin && ticket?.assignedDepartment?.code === "TRIAGE";
  const isAlreadyRouted = !!ticket?.routedTo;
  const isReservationTicket = ticket?.category?.isReservation && ticket?.reservationRequest;
  const rr = ticket?.reservationRequest;

  useEffect(() => {
    fetchTicket();
    if (isAdminUser) {
      fetch("/api/departments")
        .then((r) => r.json())
        .then(setDepartments)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fetch history when ticket loads
  useEffect(() => {
    if (ticket && isAdminUser) {
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.status, ticket?.assignedTo?.id, ticket?.routedTo?.id]);

  // Fetch conflicts for reservation tickets
  useEffect(() => {
    if (isReservationTicket && isAdminUser && rr?.status === "PENDING") {
      fetch(`/api/tickets/${id}/conflicts`)
        .then((r) => r.ok ? r.json() : [])
        .then(setConflicts)
        .catch(() => setConflicts([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, isReservationTicket, rr?.status]);

  useEffect(() => {
    if (!showOverrideModal || !overrideDate) {
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
        if (overrideFilterStartHour) params.set("startHour", overrideFilterStartHour);

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
    showOverrideModal,
    overrideDate,
    overrideFilterCampusId,
    overrideFilterRoomTypeId,
    overrideFilterPeriod,
    overrideFilterDuration,
    overrideFilterStartHour,
  ]);

  async function fetchHistory() {
    try {
      const r = await fetch(`/api/tickets/${id}/history`);
      if (r.ok) {
        setHistory(await r.json());
      } else {
        setHistory([]);
      }
    } catch {
      setHistory([]);
    }
  }

  async function fetchTicket() {
    setLoading(true);
    const res = await fetch(`/api/tickets/${id}`);
    if (!res.ok) {
      setError("Failed to load ticket.");
      setLoading(false);
      return;
    }
    setTicket(await res.json());
    setLoading(false);
  }

  async function handlePick() {
    setPicking(true);
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pick" }),
    });
    if (res.ok) {
      setTicket(await res.json());
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to pick ticket.");
    }
    setPicking(false);
  }

  async function handleUnpick() {
    setPicking(true);
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unpick" }),
    });
    if (res.ok) {
      setTicket(await res.json());
    }
    setPicking(false);
  }

  async function handleRoute() {
    if (!routeDeptId) return;
    setRouting(true);
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "route", departmentId: routeDeptId }),
    });
    if (res.ok) {
      setTicket(await res.json());
      setShowRouteForm(false);
      setRouteDeptId("");
      await fetchHistory();
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to route ticket.");
    }
    setRouting(false);
  }

  async function handleStatusChange(newStatus: string) {
    if (!isPickedByMe) return;
    setUpdatingStatus(true);
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setTicket(await res.json());
    } else {
      const data = await res.json();
      setError(data.error ?? "Status update failed.");
    }
    setUpdatingStatus(false);
  }

  async function handleAddComment(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmittingComment(true);
    const res = await fetch(`/api/tickets/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody }),
    });
    if (res.ok) {
      setCommentBody("");
      await fetchTicket();
    }
    setSubmittingComment(false);
  }

  // ── Reservation admin actions ──────────────────────────────
  async function handleAcceptReservation() {
    setProcessingReservation(true);
    const res = await fetch(`/api/tickets/${id}/reservation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    if (res.ok) {
      setTicket(await res.json());
      setShowAcceptModal(false);
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to accept reservation.");
    }
    setProcessingReservation(false);
  }

  async function handleDeclineReservation() {
    if (!declineNote.trim()) {
      setError("Admin note is required when declining a reservation.");
      return;
    }
    setProcessingReservation(true);
    const res = await fetch(`/api/tickets/${id}/reservation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decline", adminNote: declineNote.trim() }),
    });
    if (res.ok) {
      setTicket(await res.json());
      setDeclineNote("");
      setShowDeclineModal(false);
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to decline reservation.");
    }
    setProcessingReservation(false);
  }

  async function openOverrideModal() {
    const initialDate = rr ? formatDateUTC(rr.startAt) : new Date().toISOString().split("T")[0];
    setOverrideDate(initialDate);
    setOverrideSelectedSuggestion(null);
    setOverrideFilterCampusId("");
    setOverrideFilterRoomTypeId("");
    setOverrideFilterPeriod("");
    setOverrideFilterDuration("120");
    setOverrideFilterStartHour("");
    setShowOverrideModal(true);

    try {
      const [campusesRes, roomTypesRes] = await Promise.all([
        fetch("/api/campuses"),
        fetch("/api/room-types"),
      ]);
      if (campusesRes.ok) setAllCampuses(await campusesRes.json());
      if (roomTypesRes.ok) setAllRoomTypes(await roomTypesRes.json());
    } catch {
      /* ignore */
    }
  }

  async function handleOverrideReservation() {
    if (!overrideSelectedSuggestion) {
      setError("Please select an available slot to override.");
      return;
    }

    setProcessingReservation(true);
    const body = {
      action: "override",
      roomId: overrideSelectedSuggestion.roomId,
      campusId: overrideSelectedSuggestion.campusId,
      startAt: overrideSelectedSuggestion.startAt,
      endAt: overrideSelectedSuggestion.endAt,
    };

    const res = await fetch(`/api/tickets/${id}/reservation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setTicket(await res.json());
      setShowOverrideModal(false);
      setOverrideSelectedSuggestion(null);
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to override reservation.");
    }
    setProcessingReservation(false);
  }

  /** Helper: get department name by id */
  function deptName(deptId: string | null) {
    if (!deptId) return "Unknown";
    return departments.find((d) => d.id === deptId)?.name ?? deptId.slice(-6);
  }

  // Allowed next statuses based on workflow
  const allowedNext = ticket ? (VALID_TRANSITIONS[ticket.status] ?? []) : [];

  // Can this user comment? Creator or picked admin, but not on terminal statuses
  const isTerminal = ticket?.status === "RESOLVED" || ticket?.status === "DECLINED";
  const canComment = !isTerminal && (isCreator || isPickedByMe);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div>
        <div className="alert alert-error">
          {error || "Ticket not found."}
        </div>
        <Link href="/dashboard/tickets" className="btn btn-outline btn-sm mt-2">
          ← Back to Tickets
        </Link>
      </div>
    );
  }

  if (!ticket) return null;

  return (
    <div>
      {/* Error banner (dismissable) */}
      {error && (
        <div className="alert alert-error mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setError("")}>✕</button>
        </div>
      )}

      {/* Breadcrumb + title */}
      <Link href="/dashboard/tickets" className="btn btn-ghost btn-sm mb-3 -ml-2">
        ← Back to Tickets
      </Link>

      <div className="page-header flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl">
            {isReservationTicket ? "🏫 " : ""}{ticket.category.name}
            {ticket.subtype && (
              <span className="opacity-70 font-normal"> / {ticket.subtype}</span>
            )}
          </h2>
          <p>Ticket #{ticket.id.slice(-8).toUpperCase()}</p>
        </div>
        <span className={`badge ${STATUS_BADGE[ticket.status] ?? ""}`} style={{ fontSize: "0.9rem", padding: "0.3rem 1rem" }}>
          {ticket.status.replace("_", " ")}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          <div className="card">
            <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">Description</h3>
            <p className="text-foreground leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
          </div>

          {/* ── Reservation Details ──────────────────────────────── */}
          {isReservationTicket && rr && (
            <div className="card reservation-detail-card">
              <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-4">
                📅 Reservation Details
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs text-brand-gray-light uppercase font-semibold">Room</div>
                  <div className="text-sm font-medium">{rr.room.name}</div>
                  {rr.room.roomType && <div className="text-xs text-brand-gray-light">{rr.room.roomType.name}</div>}
                </div>
                <div>
                  <div className="text-xs text-brand-gray-light uppercase font-semibold">Campus</div>
                  <div className="text-sm font-medium">{rr.campus.name}</div>
                </div>
                <div>
                  <div className="text-xs text-brand-gray-light uppercase font-semibold">Date</div>
                  <div className="text-sm font-medium">{formatDateUTC(rr.startAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-brand-gray-light uppercase font-semibold">Time Slot</div>
                  <div className="text-sm font-medium">{formatTimeUTC(rr.startAt)} – {formatTimeUTC(rr.endAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-brand-gray-light uppercase font-semibold">Request Status</div>
                  <span className={`badge ${RR_STATUS_BADGE[rr.status] ?? ""}`}>{rr.status}</span>
                </div>
                <div>
                  <div className="text-xs text-brand-gray-light uppercase font-semibold">Flexibility</div>
                  <div className="text-sm">
                    {rr.adminCanAdjust
                      ? <span className="text-green-600 font-medium">🔄 Admin can adjust</span>
                      : <span className="text-brand-gray-light">Fixed</span>
                    }
                  </div>
                </div>
              </div>

              {rr.status === "DECLINED" && rr.adminNote && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <div className="text-xs text-green-800 font-semibold uppercase mb-1">Admin Note</div>
                  <p className="text-sm text-green-900">{rr.adminNote}</p>
                </div>
              )}

              {rr.approvedReservation && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <div className="text-xs text-green-800 font-semibold uppercase mb-1">✅ Approved Reservation</div>
                  <p className="text-sm text-green-900">
                    {formatTimeUTC(rr.approvedReservation.startAt)} – {formatTimeUTC(rr.approvedReservation.endAt)}
                    {" • "}{rr.approvedReservation.description}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Reservation Admin Actions ──────────────────────── */}
          {isReservationTicket && isDeptAdmin && rr?.status === "PENDING" && (
            <div className="card">
              <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">
                Reservation Actions
              </h3>

              <div className="flex flex-wrap gap-2 items-center mb-4">
                {!isTicketPicked && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handlePick}
                    disabled={picking || processingReservation}
                  >
                    {picking ? "Picking…" : "📋 Pick this Ticket"}
                  </button>
                )}
                {isPickedByMe && ticket.status !== "RESOLVED" && ticket.status !== "DECLINED" && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleUnpick}
                    disabled={picking || processingReservation}
                  >
                    {picking ? "Releasing…" : "Release Ticket"}
                  </button>
                )}
                {isTicketPicked && !isPickedByMe && (
                  <span className="text-sm text-brand-gray-light">
                    Picked by <strong>{ticket.assignedTo?.fullName}</strong>
                  </span>
                )}
              </div>

              {!isPickedByMe && (
                <p className="text-xs text-brand-gray-light mb-3">
                  Pick this ticket first before accepting, declining, or overriding this reservation.
                </p>
              )}

              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowAcceptModal(true)}
                  disabled={processingReservation || !isPickedByMe}
                >
                  ✅ Accept
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: "#dc2626", color: "#fff" }}
                  onClick={() => setShowDeclineModal(true)}
                  disabled={processingReservation || !isPickedByMe}
                >
                  ❌ Decline
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={openOverrideModal}
                  disabled={processingReservation || !isPickedByMe}
                >
                  🔧 Override
                </button>
              </div>

              {/* Accept modal */}
              {showAcceptModal && (
                <div className="mt-3 p-4 rounded-lg" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                  <h4 className="text-sm font-semibold text-green-800 mb-2">Accept Reservation</h4>
                  <p className="text-sm text-green-900 mb-3">
                    Confirm accepting this reservation for the requested slot.
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleAcceptReservation}
                      disabled={processingReservation}
                    >
                      {processingReservation ? "Processing…" : "Confirm Accept"}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => setShowAcceptModal(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Decline modal */}
              {showDeclineModal && (
                <div className="mt-3 p-4 rounded-lg" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <h4 className="text-sm font-semibold text-red-800 mb-2">Decline Reservation</h4>
                  <textarea
                    className="form-textarea mb-3"
                    rows={3}
                    placeholder="Explain why this reservation is being declined…"
                    value={declineNote}
                    onChange={(e) => setDeclineNote(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn btn-sm"
                      style={{ background: "#dc2626", color: "#fff" }}
                      onClick={handleDeclineReservation}
                      disabled={processingReservation || !declineNote.trim()}
                    >
                      {processingReservation ? "Processing…" : "Confirm Decline"}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => { setShowDeclineModal(false); setDeclineNote(""); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Override modal */}
              {showOverrideModal && (
                <div className="mt-3 p-4 rounded-lg" style={{ background: "#fef3cd", border: "1px solid #ffc107" }}>
                  <h4 className="text-sm font-semibold text-amber-800 mb-2">Override Reservation</h4>
                  <div className="mb-4">
                    <label className="form-label">Reservation Date *</label>
                    <input
                      className="form-input"
                      type="date"
                      value={overrideDate}
                      onChange={(e) => { setOverrideDate(e.target.value); setOverrideSelectedSuggestion(null); }}
                      required
                    />
                  </div>

                  <h5 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-2">
                    Filters (optional)
                  </h5>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
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
                        {allRoomTypes.map((rt) => (
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
                        <option value="90">1.5 hours</option>
                        <option value="120">2 hours</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Start Hour</label>
                      <select className="form-select" value={overrideFilterStartHour} onChange={(e) => { setOverrideFilterStartHour(e.target.value); setOverrideSelectedSuggestion(null); }}>
                        <option value="">Any</option>
                        {Array.from({ length: 10 }, (_, i) => i + 8).map((h) => (
                          <option key={h} value={String(h)}>{h}:00</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <h5 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-2">
                    Available Slots {overrideLoadingSuggestions && <span className="spinner" style={{ width: "1rem", height: "1rem", borderWidth: "2px", display: "inline-block", verticalAlign: "middle", marginLeft: "0.5rem" }} />}
                  </h5>

                  {!overrideLoadingSuggestions && overrideDate && overrideSuggestions.length === 0 && (
                    <div className="alert alert-info mb-3">
                      No available slots found for this date and filters.
                    </div>
                  )}

                  {overrideSuggestions.length > 0 && (
                    <div className="suggestion-grid mb-3">
                      {overrideSuggestions.map((s, i) => {
                        const isSelected = overrideSelectedSuggestion?.roomId === s.roomId && overrideSelectedSuggestion?.startAt === s.startAt;
                        return (
                          <div
                            key={`${s.roomId}-${s.startAt}-${i}`}
                            className={`suggestion-card ${isSelected ? "suggestion-card-selected" : ""}`}
                            onClick={() => setOverrideSelectedSuggestion(s)}
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
                                <span className="text-xs text-green-600 font-medium">✓ No pending requests</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {overrideSelectedSuggestion && (
                    <div className="card card-compact mb-3" style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                      <h5 className="text-sm font-semibold text-green-800 mb-2">📋 Selected Override Slot</h5>
                      <div className="text-sm text-green-900 space-y-1">
                        <div><strong>Room:</strong> {overrideSelectedSuggestion.roomName} ({overrideSelectedSuggestion.campusName})</div>
                        <div><strong>Date:</strong> {overrideDate}</div>
                        <div><strong>Time:</strong> {formatTimeUTC(overrideSelectedSuggestion.startAt)} – {formatTimeUTC(overrideSelectedSuggestion.endAt)}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleOverrideReservation}
                      disabled={processingReservation || !overrideSelectedSuggestion}
                    >
                      {processingReservation ? "Processing…" : "Confirm Override"}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => { setShowOverrideModal(false); setOverrideSelectedSuggestion(null); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Conflicts Panel ─────────────────────────────────── */}
          {isReservationTicket && isDeptAdmin && conflicts.length > 0 && (
            <div className="card" style={{ borderColor: "#fca5a5" }}>
              <h3 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "#dc2626" }}>
                ⚠️ Conflicting Requests ({conflicts.length})
              </h3>
              <div className="space-y-3">
                {conflicts.map((c) => (
                  <div key={c.requestId} className="p-3 rounded-lg" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold">{c.roomName} ({c.campusName})</span>
                      <span className="text-xs text-brand-gray-light">
                        {formatTimeUTC(c.startAt)} – {formatTimeUTC(c.endAt)}
                      </span>
                    </div>
                    <p className="text-sm text-brand-gray mb-1 truncate">{c.description}</p>
                    <div className="flex items-center gap-3 text-xs text-brand-gray-light">
                      <span>By: {c.createdBy.fullName}</span>
                      <span>{c.adminCanAdjust ? "🔄 Flexible" : "Fixed"}</span>
                      <Link href={`/dashboard/tickets/${c.ticketId}`} className="text-brand-primary font-medium">
                        View →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pick / Route actions for dept admins (non-reservation or already processed) */}
          {isDeptAdmin && !isReservationTicket && (
            <div className="card">
              <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">Actions</h3>
              <div className="flex flex-wrap gap-2 items-center">
                {!isTicketPicked && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handlePick}
                    disabled={picking}
                  >
                    {picking ? "Picking…" : "📋 Pick this Ticket"}
                  </button>
                )}
                {isPickedByMe && ticket.status !== "RESOLVED" && ticket.status !== "DECLINED" && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleUnpick}
                    disabled={picking}
                  >
                    {picking ? "Releasing…" : "Release Ticket"}
                  </button>
                )}
                {isTicketPicked && !isPickedByMe && (
                  <span className="text-sm text-brand-gray-light">
                    Picked by <strong>{ticket.assignedTo?.fullName}</strong>
                  </span>
                )}

                {/* Triage route button — only after picking */}
                {isTriage && isPickedByMe && !isAlreadyRouted && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowRouteForm(!showRouteForm)}
                  >
                    🔀 Route to Department
                  </button>
                )}
                {isTriage && isAlreadyRouted && (
                  <span className="text-sm text-brand-gray-light flex items-center gap-1">
                    ✅ Routed to{" "}
                    <span className="font-semibold">{ticket.routedTo!.assignedDepartment.name}</span>
                  </span>
                )}
              </div>

              {/* Route form */}
              {showRouteForm && !isAlreadyRouted && (
                <div className="mt-3 flex items-center gap-2">
                  <select
                    className="form-select"
                    style={{ width: "auto", minWidth: 200 }}
                    value={routeDeptId}
                    onChange={(e) => setRouteDeptId(e.target.value)}
                  >
                    <option value="">— Select department —</option>
                    {departments
                      .filter((d) => d.id !== ticket.assignedDepartment.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleRoute}
                    disabled={routing || !routeDeptId}
                  >
                    {routing ? "Routing…" : "Confirm Route"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Status update — only for picked admin on non-reservation tickets */}
          {isPickedByMe && !isReservationTicket && (
            <div className="card">
              <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">Update Status</h3>
              {allowedNext.length === 0 ? (
                <p className="text-sm text-brand-gray-light">
                  This ticket is in a terminal state ({ticket.status.replace("_", " ")}). No further status changes are possible.
                </p>
              ) : (
                <>
                  <p className="text-xs text-brand-gray-light mb-3">
                    Workflow: NEW → IN PROGRESS → RESOLVED / DECLINED
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_STATUSES.map((s) => {
                      const isCurrent = ticket.status === s;
                      const isAllowed = allowedNext.includes(s);
                      return (
                        <button
                          key={s}
                          className={`btn btn-sm ${
                            isCurrent
                              ? "btn-primary"
                              : isAllowed
                                ? "btn-outline"
                                : "btn-outline opacity-40 cursor-not-allowed"
                          }`}
                          disabled={isCurrent || !isAllowed || updatingStatus}
                          onClick={() => isAllowed && handleStatusChange(s)}
                          title={
                            isCurrent
                              ? "Current status"
                              : isAllowed
                                ? `Change to ${s.replace("_", " ")}`
                                : "Not available in current workflow step"
                          }
                        >
                          {s.replace("_", " ")}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

            </div>
          )}

          {/* Ticket History */}
          {history.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-4">
                Activity History
              </h3>
              <div className="relative pl-6 space-y-4">
                {/* Vertical line */}
                <div
                  className="absolute left-2 top-1 bottom-1 w-px"
                  style={{ background: "var(--border)" }}
                />
                {history.map((h) => {
                  const meta = HISTORY_META[h.action] ?? { icon: "•", label: h.action };
                  let detail = "";
                  if (h.action === "STATUS_CHANGED") {
                    detail = `${(h.oldStatus ?? "").replace("_", " ")} → ${(h.newStatus ?? "").replace("_", " ")}`;
                  } else if (h.action === "ROUTED") {
                    detail = `${deptName(h.fromDepartmentId)} → ${deptName(h.toDepartmentId)}`;
                  }
                  return (
                    <div key={h.id} className="relative flex gap-3 items-start">
                      <span
                        className="absolute -left-4 flex items-center justify-center w-5 h-5 rounded-full text-xs"
                        style={{ background: "var(--card-bg)", border: "1px solid var(--border)" }}
                      >
                        {meta.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{meta.label}</span>
                          {detail && (
                            <span className="text-xs text-brand-gray-light">({detail})</span>
                          )}
                        </div>
                        <div className="text-xs text-brand-gray-light">
                          by <strong>{h.performedBy.fullName}</strong> — {new Date(h.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="card">
            <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-4">
              Comments ({ticket.comments.length})
            </h3>

            {ticket.comments.length === 0 ? (
              <p className="text-sm text-brand-gray-light">No comments yet.</p>
            ) : (
              <div className="space-y-4 mb-5">
                {ticket.comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div
                      className="avatar shrink-0 mt-0.5"
                      style={{
                        background: c.author.role === "ADMIN" ? "var(--brand-primary)" : "var(--brand-gray)",
                      }}
                    >
                      {c.author.fullName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold">{c.author.fullName}</span>
                        {c.author.role === "ADMIN" && (
                          <span className="badge badge-admin" style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}>
                            {c.author.department?.name ?? "ADMIN"}
                          </span>
                        )}
                        <span className="text-xs text-brand-gray-light">
                          {new Date(c.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment form */}
            {canComment ? (
              <div className="border-t border-border pt-4 mt-4">
                <form onSubmit={handleAddComment}>
                  <textarea
                    className="form-textarea mb-3"
                    rows={3}
                    placeholder="Write a comment…"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    required
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    type="submit"
                    disabled={submittingComment || !commentBody.trim()}
                  >
                    {submittingComment ? "Posting…" : "Add Comment"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="border-t border-border pt-4 mt-4">
                <p className="text-sm text-brand-gray-light">
                  {isTerminal
                    ? "This ticket is closed. No further comments can be added."
                    : isAdminUser && isDeptAdmin && !isPickedByMe
                      ? "Pick this ticket to comment and update status."
                      : "Only the ticket creator or the assigned admin can comment."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="card card-compact sticky top-20">
            <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-4">Details</h3>
            <dl className="detail-list">
              <dt>Category</dt>
              <dd>{ticket.category.name}</dd>

              {ticket.subtype && (
                <>
                  <dt>Sub-type</dt>
                  <dd>{ticket.subtype}</dd>
                </>
              )}

              <dt>Assigned Department</dt>
              <dd>
                <span className="badge badge-role">{ticket.assignedDepartment.name}</span>
              </dd>

              {ticket.routedTo && (
                <>
                  <dt>Routed To</dt>
                  <dd>
                    <span className="badge badge-role">
                      {ticket.routedTo.assignedDepartment.name}
                    </span>
                  </dd>
                </>
              )}

              {ticket.routedFrom && (
                <>
                  <dt>Routed From</dt>
                  <dd>
                    <span className="badge badge-role">
                      {ticket.routedFrom.assignedDepartment.name}
                    </span>
                  </dd>
                </>
              )}

              <dt>Picked By</dt>
              <dd>
                {ticket.assignedTo ? (
                  <span className="text-sm font-medium">{ticket.assignedTo.fullName}</span>
                ) : (
                  <span className="text-sm text-brand-gray-light italic">Not yet picked</span>
                )}
              </dd>

              <dt>Created By</dt>
              <dd>
                <div className="flex items-center gap-2">
                  <div
                    className="avatar"
                    style={{
                      width: "1.5rem",
                      height: "1.5rem",
                      fontSize: "0.7rem",
                      background: ticket.createdBy.role === "ADMIN" ? "var(--brand-primary)" : "var(--brand-gray)",
                    }}
                  >
                    {ticket.createdBy.fullName.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{ticket.createdBy.fullName}</div>
                    <div className="text-xs text-brand-gray-light">
                      {ticket.createdBy.role === "ADMIN"
                        ? `Admin — ${ticket.createdBy.department?.name ?? "Unknown Dept"}`
                        : ticket.createdBy.profile}
                    </div>
                  </div>
                </div>
              </dd>

              <dt>Created</dt>
              <dd>{new Date(ticket.createdAt).toLocaleString()}</dd>

              <dt>Last Updated</dt>
              <dd>{new Date(ticket.updatedAt).toLocaleString()}</dd>

              {/* Reservation sidebar details */}
              {isReservationTicket && rr && (
                <>
                  <dt>Room</dt>
                  <dd>{rr.room.name}</dd>
                  <dt>Campus</dt>
                  <dd>{rr.campus.name}</dd>
                  <dt>Time Slot</dt>
                  <dd>{formatTimeUTC(rr.startAt)} – {formatTimeUTC(rr.endAt)}</dd>
                  <dt>Request Status</dt>
                  <dd><span className={`badge ${RR_STATUS_BADGE[rr.status] ?? ""}`}>{rr.status}</span></dd>
                </>
              )}

            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
