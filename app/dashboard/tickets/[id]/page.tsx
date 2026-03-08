"use client";

import { useEffect, useState, FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string; role: string };
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
  createdBy: { id: string; fullName: string; email: string; role: string; profile: string | null };
  assignedDepartment: { id: string; name: string; code: string };
  comments: Comment[];
  reservationRequest: null; // future use
};

const STATUS_CLASSES: Record<string, string> = {
  NEW: "uk-label-warning",
  IN_PROGRESS: "uk-label-primary",
  RESOLVED: "uk-label-success",
  DECLINED: "uk-label-danger",
};

const STATUS_OPTIONS = ["NEW", "IN_PROGRESS", "RESOLVED", "DECLINED"];

export default function TicketDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { data: session } = useSession();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Comment form
  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const user = session?.user;
  const isAdmin = user?.role === "ADMIN";
  const isAssignedAdmin =
    isAdmin && ticket?.assignedDepartment?.id === user?.departmentId;

  useEffect(() => {
    fetchTicket();
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

  async function handleStatusChange(newStatus: string) {
    if (!isAssignedAdmin) return;
    setUpdatingStatus(true);
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      await fetchTicket();
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

  if (loading) {
    return (
      <div className="uk-text-center uk-padding">
        <div data-uk-spinner />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="uk-alert uk-alert-danger">
        <p>{error || "Ticket not found."}</p>
        <Link href="/dashboard/tickets" className="uk-button uk-button-default uk-button-small">
          ← Back to Tickets
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="uk-flex uk-flex-between uk-flex-middle uk-margin-bottom">
        <div>
          <Link href="/dashboard/tickets" className="uk-button uk-button-text uk-button-small">
            ← Back to Tickets
          </Link>
          <h2 className="uk-heading-small uk-margin-small-top uk-margin-remove-bottom">
            {ticket.category.name}
            {ticket.subtype && (
              <span className="uk-text-muted"> / {ticket.subtype}</span>
            )}
          </h2>
          <p className="uk-text-meta uk-margin-remove-top">
            Ticket #{ticket.id.slice(-8).toUpperCase()}
          </p>
        </div>
        <div>
          <span className={`uk-label ${STATUS_CLASSES[ticket.status] ?? ""}`} style={{ fontSize: "1rem" }}>
            {ticket.status.replace("_", " ")}
          </span>
        </div>
      </div>

      <div className="uk-grid uk-grid-medium" data-uk-grid>
        {/* Main content */}
        <div className="uk-width-2-3@m">
          {/* Description */}
          <div className="uk-card uk-card-default uk-card-body uk-margin-bottom">
            <h4 className="uk-card-title">Description</h4>
            <p style={{ whiteSpace: "pre-wrap" }}>{ticket.description}</p>
          </div>

          {/* Admin actions */}
          {isAssignedAdmin && (
            <div className="uk-card uk-card-default uk-card-body uk-margin-bottom">
              <h4 className="uk-card-title">Admin Actions</h4>
              <div className="uk-button-group">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`uk-button uk-button-small ${
                      ticket.status === s ? "uk-button-primary" : "uk-button-default"
                    }`}
                    disabled={ticket.status === s || updatingStatus}
                    onClick={() => handleStatusChange(s)}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
              {ticket.priority && (
                <p className="uk-text-meta uk-margin-small-top">
                  AI Priority: <strong>{ticket.priority}</strong>
                  {ticket.aiReason && <> — {ticket.aiReason}</>}
                </p>
              )}
            </div>
          )}

          {/* Comments */}
          <div className="uk-card uk-card-default uk-card-body">
            <h4 className="uk-card-title">
              Comments ({ticket.comments.length})
            </h4>

            {ticket.comments.length === 0 ? (
              <p className="uk-text-muted">No comments yet.</p>
            ) : (
              <ul className="uk-comment-list">
                {ticket.comments.map((c) => (
                  <li key={c.id} className="uk-margin-bottom">
                    <article className="uk-comment">
                      <header className="uk-comment-header uk-flex uk-flex-middle" style={{ gap: "0.5rem" }}>
                        <span
                          className="uk-border-circle uk-flex uk-flex-center uk-flex-middle"
                          style={{
                            width: 32,
                            height: 32,
                            background: c.author.role === "ADMIN" ? "#1e87f0" : "#999",
                            color: "#fff",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                          }}
                        >
                          {c.author.fullName.charAt(0)}
                        </span>
                        <div>
                          <h6 className="uk-comment-title uk-margin-remove" style={{ fontSize: "0.9rem" }}>
                            {c.author.fullName}
                            {c.author.role === "ADMIN" && (
                              <span className="uk-badge uk-margin-small-left" style={{ fontSize: "0.65rem" }}>
                                ADMIN
                              </span>
                            )}
                          </h6>
                          <p className="uk-comment-meta uk-margin-remove">
                            {new Date(c.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </header>
                      <div className="uk-comment-body uk-margin-small-top">
                        <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}

            {/* Add comment form */}
            <hr className="uk-divider-icon" />
            <form onSubmit={handleAddComment}>
              <div className="uk-margin">
                <textarea
                  className="uk-textarea"
                  rows={3}
                  placeholder="Write a comment…"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  required
                />
              </div>
              <button
                className="uk-button uk-button-primary uk-button-small"
                type="submit"
                disabled={submittingComment || !commentBody.trim()}
              >
                {submittingComment ? "Posting…" : "Add Comment"}
              </button>
            </form>
          </div>
        </div>

        {/* Sidebar */}
        <div className="uk-width-1-3@m">
          <div className="uk-card uk-card-default uk-card-body uk-card-small">
            <h5 className="uk-card-title">Details</h5>
            <dl className="uk-description-list uk-description-list-divider">
              <dt>Category</dt>
              <dd>{ticket.category.name}</dd>

              {ticket.subtype && (
                <>
                  <dt>Sub-type</dt>
                  <dd>{ticket.subtype}</dd>
                </>
              )}

              <dt>Assigned Department</dt>
              <dd>{ticket.assignedDepartment.name}</dd>

              <dt>Created By</dt>
              <dd>
                {ticket.createdBy.fullName}
                <br />
                <span className="uk-text-muted uk-text-small">
                  {ticket.createdBy.role === "ADMIN" ? "Admin" : ticket.createdBy.profile}
                </span>
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
