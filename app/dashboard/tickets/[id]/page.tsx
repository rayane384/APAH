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
  comments: Comment[];
  reservationRequest: null;
};

const STATUS_BADGE: Record<string, string> = {
  NEW: "badge-new",
  IN_PROGRESS: "badge-in-progress",
  RESOLVED: "badge-resolved",
  DECLINED: "badge-declined",
};

const STATUS_OPTIONS = ["NEW", "IN_PROGRESS", "RESOLVED", "DECLINED"];

export default function TicketDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data: session } = useSession();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);

  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [picking, setPicking] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routeDeptId, setRouteDeptId] = useState("");
  const [showRouteForm, setShowRouteForm] = useState(false);

  const user = session?.user;
  const isAdmin = user?.role === "ADMIN";
  const isDeptAdmin =
    isAdmin && ticket?.assignedDepartment?.id === user?.departmentId;
  const isPickedByMe = ticket?.assignedTo?.id === user?.id;
  const isTicketPicked = !!ticket?.assignedTo;
  const isCreator = ticket?.createdBy?.id === user?.id;
  const isTriage =
    isDeptAdmin && ticket?.assignedDepartment?.code === "TRIAGE";

  useEffect(() => {
    fetchTicket();
    if (isAdmin) {
      fetch("/api/departments")
        .then((r) => r.json())
        .then(setDepartments)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  // Can this user comment? Creator or picked admin
  const canComment = isCreator || isPickedByMe;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="spinner" />
      </div>
    );
  }

  if (error || !ticket) {
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

  return (
    <div>
      {/* Breadcrumb + title */}
      <Link href="/dashboard/tickets" className="btn btn-ghost btn-sm mb-3 -ml-2">
        ← Back to Tickets
      </Link>

      <div className="page-header flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl">
            {ticket.category.name}
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

          {/* Pick / Route actions for dept admins */}
          {isDeptAdmin && (
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
                {isPickedByMe && (
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

                {/* Triage route button */}
                {isTriage && (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowRouteForm(!showRouteForm)}
                    >
                      🔀 Route to Department
                    </button>
                  </>
                )}
              </div>

              {/* Route form */}
              {showRouteForm && (
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

          {/* Status update — only for picked admin */}
          {isPickedByMe && (
            <div className="card">
              <h3 className="text-sm font-semibold text-brand-gray-light uppercase tracking-wide mb-3">Update Status</h3>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`btn btn-sm ${
                      ticket.status === s
                        ? "btn-primary"
                        : "btn-outline"
                    }`}
                    disabled={ticket.status === s || updatingStatus}
                    onClick={() => handleStatusChange(s)}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
              {ticket.priority && (
                <p className="form-hint mt-3">
                  AI Priority: <strong>{ticket.priority}</strong>
                  {ticket.aiReason && <> — {ticket.aiReason}</>}
                </p>
              )}
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

            {/* Add comment form — only creator or picked admin */}
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
                  {isAdmin && isDeptAdmin && !isPickedByMe
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

              {ticket.priority && (
                <>
                  <dt>Priority</dt>
                  <dd>{ticket.priority}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
