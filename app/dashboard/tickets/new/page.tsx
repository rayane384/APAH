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

export default function NewTicketPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [categories, setCategories] = useState<Category[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [categoryId, setCategoryId] = useState("");
  const [subtype, setSubtype] = useState("");
  const [description, setDescription] = useState("");
  const [targetDeptId, setTargetDeptId] = useState("");

  const selectedCategory = categories.find((c) => c.id === categoryId);

  // When admin selects a category, auto-fill from category default
  useEffect(() => {
    if (isAdmin && selectedCategory) {
      setTargetDeptId(selectedCategory.ownerDepartment.id);
    }
  }, [categoryId, isAdmin, selectedCategory]);

  useEffect(() => {
    Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      isAdmin ? fetch("/api/departments").then((r) => r.json()) : Promise.resolve([]),
    ])
      .then(([cats, depts]: [Category[], Department[]]) => {
        setCategories(cats);
        setDepartments(depts);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isAdmin]);

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
    if (selectedCategory?.isReservation) {
      setError("Reservation tickets are coming soon. Please choose another category.");
      return;
    }

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
        <h2 className="text-2xl">Create New Ticket</h2>
        <p>Fill in the details to submit a new ticket</p>
      </div>

      <div className="card max-w-2xl">
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
              {categories
                .filter((c) => !c.isReservation)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.ownerDepartment.name})
                  </option>
                ))}
              {categories
                .filter((c) => c.isReservation)
                .map((c) => (
                  <option key={c.id} value={c.id} disabled>
                    {c.name} (coming soon)
                  </option>
                ))}
            </select>
            {selectedCategory && !isAdmin && (
              <p className="form-hint mt-1">
                Will be sent to: <strong>{selectedCategory.ownerDepartment.name}</strong>
              </p>
            )}
          </div>

          {/* Target Department (admin only) */}
          {isAdmin && (
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

          {/* Subtype */}
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

          {/* Description */}
          <div>
            <label className="form-label">Description *</label>
            <textarea
              className="form-textarea"
              rows={5}
              placeholder="Describe your issue or request…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="spinner" style={{ width: "1rem", height: "1rem", borderWidth: "2px" }} />
                  Creating…
                </span>
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
