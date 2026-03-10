"use client";

import { useEffect, useState } from "react";
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

export default function TicketListPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");

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

        <span className="text-sm text-brand-gray-light ml-auto">
          {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="spinner" />
        </div>
      ) : tickets.length === 0 ? (
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
                <th>Date</th>
                <th className="text-center">💬</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
