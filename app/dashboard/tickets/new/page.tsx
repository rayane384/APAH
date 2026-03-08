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

  const selectedCategory = categories.find((c) => c.id === categoryId);

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

    // Block reservation category for now
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
      <div className="uk-text-center uk-padding">
        <div data-uk-spinner />
      </div>
    );
  }

  return (
    <div>
      <h2 className="uk-heading-small">Create New Ticket</h2>

      {error && (
        <div className="uk-alert uk-alert-danger" data-uk-alert>
          <a className="uk-alert-close" data-uk-close />
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="uk-form-stacked uk-width-xlarge">
        {/* Category */}
        <div className="uk-margin">
          <label className="uk-form-label">Category *</label>
          <div className="uk-form-controls">
            <select
              className="uk-select"
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
              {/* Reservation category shown but disabled */}
              {categories
                .filter((c) => c.isReservation)
                .map((c) => (
                  <option key={c.id} value={c.id} disabled>
                    {c.name} (coming soon)
                  </option>
                ))}
            </select>
          </div>
          {selectedCategory && (
            <p className="uk-text-meta uk-margin-small-top">
              Default department: <strong>{selectedCategory.ownerDepartment.name}</strong>
            </p>
          )}
        </div>

        {/* Target Department (admin only) */}
        {isAdmin && (
          <div className="uk-margin">
            <label className="uk-form-label">Send to Department</label>
            <div className="uk-form-controls">
              <select
                className="uk-select"
                value={targetDeptId}
                onChange={(e) => setTargetDeptId(e.target.value)}
              >
                <option value="">
                  — Default ({selectedCategory?.ownerDepartment.name ?? "select category first"}) —
                </option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
            <p className="uk-text-meta uk-margin-small-top">
              As an admin, you can send this ticket to a specific department.
            </p>
          </div>
        )}

        {/* Subtype */}
        <div className="uk-margin">
          <label className="uk-form-label">Sub-type (optional)</label>
          <div className="uk-form-controls">
            <input
              className="uk-input"
              type="text"
              placeholder="e.g., Projector, Printer…"
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
            />
          </div>
        </div>

        {/* Description */}
        <div className="uk-margin">
          <label className="uk-form-label">Description *</label>
          <div className="uk-form-controls">
            <textarea
              className="uk-textarea"
              rows={5}
              placeholder="Describe your issue or request…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="uk-margin">
          <button
            className="uk-button uk-button-primary"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Creating…" : "Submit Ticket"}
          </button>
          <button
            className="uk-button uk-button-default uk-margin-small-left"
            type="button"
            onClick={() => router.push("/dashboard/tickets")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
