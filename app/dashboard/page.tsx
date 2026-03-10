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
    ? {
        OR: [
          { assignedDepartmentId: user.departmentId },
          { createdBy: { departmentId: user.departmentId, role: "ADMIN" } },
        ],
      }
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
    { label: "Total", value: total, colorClass: "text-brand-gray", bgClass: "" },
    { label: "New", value: newCount, colorClass: "text-[#856404]", bgClass: "badge-new" },
    { label: "In Progress", value: inProgress, colorClass: "text-[#084298]", bgClass: "badge-in-progress" },
    { label: "Resolved", value: resolved, colorClass: "text-[#0f5132]", bgClass: "badge-resolved" },
    { label: "Declined", value: declined, colorClass: "text-[#842029]", bgClass: "badge-declined" },
  ];

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <h2 className="text-2xl">
          Dashboard
        </h2>
        <p>
          {admin
            ? `Tickets for ${departmentName || "your department"} & tickets you created`
            : "Your tickets overview"}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`stat-value ${s.colorClass}`}>{s.value}</div>
            <div className={`stat-label ${s.colorClass}`}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/tickets" className="btn btn-secondary">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          View All Tickets
        </Link>
        <Link href="/dashboard/tickets/new" className="btn btn-primary">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Ticket
        </Link>
      </div>
    </div>
  );
}
