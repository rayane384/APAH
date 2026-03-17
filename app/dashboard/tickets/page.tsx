"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Ticket = {
  id: string;
  subtype: string | null;
  description: string;
  status: string;
  priority: string | null;
  createdAt: string;
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
  _count: { comments: number };
};

const STATUS_BADGE: Record<string, string> = {
  NEW: "badge-new",
  IN_PROGRESS: "badge-in-progress",
  RESOLVED: "badge-resolved",
  DECLINED: "badge-declined",
};

/* ── Priority Points ──────────────────────────────────────── */
const CATEGORY_POINTS: Record<string, number> = {
  RESERVATION: 5,
  OTHER: 2,
};
const DEFAULT_CATEGORY_POINTS = 3;

const CREATOR_POINTS: Record<string, number> = {
  ADMIN: 5,
  PROF: 4,
  DELEGUE: 3,
  CLUB_PRESIDENT: 2,
};
const DEFAULT_CREATOR_POINTS = 1;

function getPriorityScore(ticket: Ticket): number {
  const catCode = ticket.category.code?.toUpperCase() ?? "";
  const catPts = CATEGORY_POINTS[catCode] ?? (ticket.category.isReservation ? 5 : ticket.category.isOther ? 2 : DEFAULT_CATEGORY_POINTS);

  let creatorKey = ticket.createdBy.role;
  if (ticket.createdBy.role !== "ADMIN" && ticket.createdBy.profile) {
    creatorKey = ticket.createdBy.profile;
  }
  const creatorPts = CREATOR_POINTS[creatorKey] ?? DEFAULT_CREATOR_POINTS;

  return catPts + creatorPts;
}

const PRIORITY_COLORS: Record<number, { bg: string; color: string }> = {
  10: { bg: "#dc2626", color: "#fff" },
  9: { bg: "#dc2626", color: "#fff" },
  8: { bg: "#ea580c", color: "#fff" },
  7: { bg: "#d97706", color: "#fff" },
  6: { bg: "#ca8a04", color: "#fff" },
  5: { bg: "#65a30d", color: "#fff" },
  4: { bg: "#0d9488", color: "#fff" },
  3: { bg: "#6b7280", color: "#fff" },
  2: { bg: "#9ca3af", color: "#fff" },
};

function getPriorityStyle(score: number) {
  return PRIORITY_COLORS[score] ?? PRIORITY_COLORS[3];
}

export default function TicketListPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [prioritySort, setPrioritySort] = useState(false);

  useEffect(() => {
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sortOrder, directionFilter]);

  async function fetchTickets() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (directionFilter) params.set("direction", directionFilter);
    params.set("sort", sortOrder);

    const res = await fetch(`/api/tickets?${params.toString()}`);
    if (res.ok) {
      setTickets(await res.json());
    }
    setLoading(false);
  }

  const sortedTickets = useMemo(() => {
    if (!prioritySort) return tickets;
    return [...tickets].sort((a, b) => getPriorityScore(b) - getPriorityScore(a));
  }, [tickets, prioritySort]);

  return (
    <div>
      {/* Page header */}
      <div className="page-header flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl">Tickets</h2>
          <p>Manage and track all your tickets</p>
        </div>
        <Link href="/dashboard/tickets/new" className="btn btn-secondary btn-sm" style={{ background: "rgba(255,255,255,0.2)", color: "#fff", borderColor: "rgba(255,255,255,0.3)" }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Ticket
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {isAdmin && (
          <select
            className="form-select"
            style={{ width: "auto", minWidth: 160 }}
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
          >
            <option value="">All tickets</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
            <option value="mine">My Tickets</option>
          </select>
        )}

        <select
          className="form-select"
          style={{ width: "auto", minWidth: 160 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="NEW">New</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DECLINED">Declined</option>
        </select>

        <select
          className="form-select"
          style={{ width: "auto", minWidth: 160 }}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>

        {/* Priority sort toggle */}
        {isAdmin && (
          <button
            className={`btn btn-sm ${prioritySort ? "btn-primary" : "btn-outline"}`}
            onClick={() => setPrioritySort(!prioritySort)}
            title="Sort tickets by computed priority score (category + creator points)"
          >
            {prioritySort ? "⚡ Priority: ON" : "⚡ Priority"}
          </button>
        )}

        <span className="text-sm text-brand-gray-light ml-auto">
          {sortedTickets.length} ticket{sortedTickets.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="spinner" />
        </div>
      ) : sortedTickets.length === 0 ? (
        <div className="alert alert-info">
          No tickets found. Try changing your filters or create a new ticket.
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Created By</th>
                <th>Department</th>
                <th>Picked By</th>
                <th>Status</th>
                {isAdmin && prioritySort && <th className="text-center">Priority</th>}
                <th>Date</th>
                <th className="text-center">💬</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortedTickets.map((t) => {
                const score = getPriorityScore(t);
                const pStyle = getPriorityStyle(score);
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="font-semibold text-sm">{t.category.name}</div>
                      {t.subtype && (
                        <div className="text-xs text-brand-gray-light">{t.subtype}</div>
                      )}
                    </td>
                    <td>
                      <div className="text-sm max-w-[250px] truncate">{t.description}</div>
                    </td>
                    <td>
                      <div className="text-sm font-medium">{t.createdBy.fullName}</div>
                      <div className="text-xs text-brand-gray-light">
                        {t.createdBy.role === "ADMIN"
                          ? `Admin — ${t.createdBy.department?.name ?? ""}`
                          : t.createdBy.profile}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-role">{t.assignedDepartment.name}</span>
                    </td>
                    <td>
                      {t.assignedTo ? (
                        <span className="text-sm font-medium">{t.assignedTo.fullName}</span>
                      ) : (
                        <span className="text-xs text-brand-gray-light italic">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[t.status] ?? ""}`}>
                        {t.status.replace("_", " ")}
                      </span>
                    </td>
                    {isAdmin && prioritySort && (
                      <td className="text-center">
                        <span
                          className="badge"
                          style={{
                            background: pStyle.bg,
                            color: pStyle.color,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            minWidth: "2rem",
                          }}
                        >
                          {score}
                        </span>
                      </td>
                    )}
                    <td className="text-sm text-brand-gray-light whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="text-center text-sm text-brand-gray-light">
                      {t._count.comments}
                    </td>
                    <td>
                      <Link
                        href={`/dashboard/tickets/${t.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
