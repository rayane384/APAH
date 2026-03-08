import { redirect } from "next/navigation";
import { prisma } from "../lib/prisma";
import { getCurrentUser, isAdmin } from "../lib/auth-helpers";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = admin
    ? { assignedDepartmentId: user.departmentId }
    : { createdById: user.id };

  const [total, newCount, inProgress, resolved, declined] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.count({ where: { ...where, status: "NEW" } }),
    prisma.ticket.count({ where: { ...where, status: "IN_PROGRESS" } }),
    prisma.ticket.count({ where: { ...where, status: "RESOLVED" } }),
    prisma.ticket.count({ where: { ...where, status: "DECLINED" } }),
  ]);

  // For admins, get their department name
  let departmentName = "";
  if (admin && user.departmentId) {
    const dept = await prisma.department.findUnique({
      where: { id: user.departmentId },
      select: { name: true },
    });
    departmentName = dept?.name ?? "";
  }

  const stats = [
    { label: "Total", value: total, color: "" },
    { label: "New", value: newCount, color: "uk-label-warning" },
    { label: "In Progress", value: inProgress, color: "uk-label-primary" },
    { label: "Resolved", value: resolved, color: "uk-label-success" },
    { label: "Declined", value: declined, color: "uk-label-danger" },
  ];

  return (
    <div>
      <h2 className="uk-heading-small">
        Dashboard
        {admin && departmentName && (
          <span className="uk-text-muted uk-text-small uk-margin-small-left">
            — {departmentName}
          </span>
        )}
      </h2>

      <p className="uk-text-meta">
        {admin ? "Tickets assigned to your department" : "Your tickets overview"}
      </p>

      <div className="uk-grid uk-grid-small uk-child-width-1-5@m uk-child-width-1-2 uk-margin" data-uk-grid>
        {stats.map((s) => (
          <div key={s.label}>
            <div className="uk-card uk-card-default uk-card-body uk-card-small uk-text-center">
              <h1 className="uk-heading-small uk-margin-remove">{s.value}</h1>
              <span className={`uk-label ${s.color}`}>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="uk-margin-top">
        <Link href="/dashboard/tickets" className="uk-button uk-button-primary uk-margin-small-right">
          View All Tickets
        </Link>
        <Link href="/dashboard/tickets/new" className="uk-button uk-button-default">
          Create Ticket
        </Link>
      </div>
    </div>
  );
}
