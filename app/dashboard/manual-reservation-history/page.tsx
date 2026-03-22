"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Campus = { id: string; name: string; code: string };
type RoomType = { id: string; name: string; code: string } | null;

type HistoryItem = {
  id: string;
  status: "APPROVED" | "CANCELLED";
  description: string;
  isRecurring: boolean;
  startAt: string;
  endAt: string;
  recurrenceEndDate: string | null;
  createdAt: string;
  room: {
    id: string;
    name: string;
    code: string;
    campus: Campus;
    roomType: RoomType;
  };
  createdBy: { id: string; fullName: string; email: string } | null;
};

type HistoryResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: HistoryItem[];
};

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "badge-resolved",
  CANCELLED: "badge-declined",
};

function formatDateTimeUTC(iso: string) {
  const d = new Date(iso);
  return `${d.toISOString().split("T")[0]} ${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}

export default function ManualReservationHistoryPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN" && session?.user?.isReservationAdmin;

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function fetchHistory() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/reservations/manual-history?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to load manual reservation history.");
        setItems([]);
        return;
      }

      const data = (await res.json()) as HistoryResponse;
      setItems(data.items);
    } catch {
      setError("Network error while loading manual reservation history.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  if (!isAdmin) {
    return <div className="alert alert-error">Access Denied. Only Reservation Admins can view this section.</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="text-2xl">Manual Reservation History</h2>
        <p>All manually taken room slots are recorded here.</p>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <select
          className="form-select"
          style={{ width: "auto", minWidth: 180 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <span className="text-sm text-brand-gray-light ml-auto">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : items.length === 0 ? (
        <div className="alert alert-info">No manual reservation records found.</div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Timeslot</th>
                <th>Recurrence</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Created At</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="font-semibold text-sm">{item.room.name}</div>
                    <div className="text-xs text-brand-gray-light">
                      {item.room.code} · {item.room.campus.name}
                    </div>
                  </td>
                  <td>
                    <div className="text-sm">{formatDateTimeUTC(item.startAt)} → {formatDateTimeUTC(item.endAt)}</div>
                  </td>
                  <td>
                    {item.isRecurring ? (
                      <div className="text-sm">
                        Weekly
                        <div className="text-xs text-brand-gray-light">
                          Until {item.recurrenceEndDate ? item.recurrenceEndDate.split("T")[0] : "No end"}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm">Single</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[item.status] ?? ""}`}>{item.status}</span>
                  </td>
                  <td>{item.createdBy?.fullName ?? "—"}</td>
                  <td>{item.createdAt.split("T")[0]}</td>
                  <td className="text-right">
                    <Link href={`/dashboard/manual-reservation-history/${item.id}`} className="btn btn-sm btn-outline">
                      View
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
