"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Ticket = {
  id: string;
  subtype: string | null;
  description: string;
  status: string;
  priority: string | null;
  createdAt: string;
  category: { id: string; name: string; code: string; isReservation: boolean; isOther: boolean };
  createdBy: { id: string; fullName: string; email: string; role: string; profile: string | null };
  assignedDepartment: { id: string; name: string; code: string };
  _count: { comments: number };
};

const STATUS_CLASSES: Record<string, string> = {
  NEW: "uk-label-warning",
  IN_PROGRESS: "uk-label-primary",
  RESOLVED: "uk-label-success",
  DECLINED: "uk-label-danger",
};

export default function TicketListPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");

  useEffect(() => {
    fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sortOrder]);

  async function fetchTickets() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    params.set("sort", sortOrder);

    const res = await fetch(`/api/tickets?${params.toString()}`);
    if (res.ok) {
      setTickets(await res.json());
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="uk-flex uk-flex-between uk-flex-middle uk-margin-bottom">
        <h2 className="uk-heading-small uk-margin-remove">Tickets</h2>
        <Link href="/dashboard/tickets/new" className="uk-button uk-button-primary uk-button-small">
          + New Ticket
        </Link>
      </div>

      {/* Filters */}
      <div className="uk-flex uk-flex-wrap uk-flex-middle uk-margin-bottom" style={{ gap: "0.5rem" }}>
        <select
          className="uk-select uk-form-small uk-form-width-medium"
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
          className="uk-select uk-form-small uk-form-width-medium"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {loading ? (
        <div className="uk-text-center uk-padding">
          <div data-uk-spinner />
        </div>
      ) : tickets.length === 0 ? (
        <div className="uk-alert uk-alert-primary">
          <p>No tickets found.</p>
        </div>
      ) : (
        <table className="uk-table uk-table-hover uk-table-divider uk-table-middle uk-table-small">
          <thead>
            <tr>
              <th>Category</th>
              <th>Description</th>
              <th>Created By</th>
              <th>Department</th>
              <th>Status</th>
              <th>Date</th>
              <th className="uk-text-center">Comments</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="uk-text-bold">{t.category.name}</span>
                  {t.subtype && (
                    <span className="uk-text-muted uk-text-small"> / {t.subtype}</span>
                  )}
                </td>
                <td className="uk-text-truncate" style={{ maxWidth: 250 }}>
                  {t.description}
                </td>
                <td>
                  <span>{t.createdBy.fullName}</span>
                  <br />
                  <span className="uk-text-muted uk-text-small">
                    {t.createdBy.role === "ADMIN" ? "Admin" : t.createdBy.profile}
                  </span>
                </td>
                <td>{t.assignedDepartment.name}</td>
                <td>
                  <span className={`uk-label ${STATUS_CLASSES[t.status] ?? ""}`}>
                    {t.status.replace("_", " ")}
                  </span>
                </td>
                <td className="uk-text-small">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="uk-text-center">{t._count.comments}</td>
                <td>
                  <Link
                    href={`/dashboard/tickets/${t.id}`}
                    className="uk-button uk-button-text uk-button-small"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
