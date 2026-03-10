import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

const ticketInclude = {
  category: {
    select: { id: true, name: true, code: true, isReservation: true, isOther: true },
  },
  createdBy: {
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      profile: true,
      department: { select: { id: true, name: true, code: true } },
    },
  },
  assignedDepartment: { select: { id: true, name: true, code: true } },
  assignedTo: {
    select: { id: true, fullName: true, email: true },
  },
  comments: {
    include: {
      author: {
        select: {
          id: true,
          fullName: true,
          role: true,
          department: { select: { id: true, name: true, code: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  reservationRequest: true,
};

/**
 * GET /api/tickets/[id]
 * Retrieve a single ticket with comments.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: ticketInclude,
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  // Access: creator, any admin of assigned dept, or any admin of sender's dept
  const isCreator = ticket.createdById === user.id;
  const isDeptAdmin = isAdmin(user) && ticket.assignedDepartmentId === user.departmentId;
  const isSenderDeptAdmin =
    isAdmin(user) && ticket.createdBy.department?.id === user.departmentId;

  if (!isCreator && !isDeptAdmin && !isSenderDeptAdmin) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  return NextResponse.json(ticket);
}

/**
 * PATCH /api/tickets/[id]
 * Actions:
 *   { action: "pick" }                — claim the ticket (assigned dept admin)
 *   { action: "unpick" }              — release the ticket (currently picked admin)
 *   { action: "route", departmentId } — triage routes ticket to another dept
 *   { status: "..." }                 — update status (only the picked admin)
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Only admins can update tickets." }, { status: 403 });
  }

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const body = await request.json();
  const { action, status, departmentId } = body as {
    action?: string;
    status?: string;
    departmentId?: string;
  };

  // ── Pick / Unpick ──────────────────────────────────────────
  if (action === "pick") {
    if (ticket.assignedDepartmentId !== user.departmentId) {
      return NextResponse.json(
        { error: "You can only pick tickets assigned to your department." },
        { status: 403 }
      );
    }
    if (ticket.assignedToId) {
      return NextResponse.json(
        { error: "This ticket is already picked by another admin." },
        { status: 409 }
      );
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: { assignedToId: user.id },
      include: ticketInclude,
    });
    return NextResponse.json(updated);
  }

  if (action === "unpick") {
    if (ticket.assignedToId !== user.id) {
      return NextResponse.json(
        { error: "You can only release tickets you picked." },
        { status: 403 }
      );
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: { assignedToId: null },
      include: ticketInclude,
    });
    return NextResponse.json(updated);
  }

  // ── Route (triage) ────────────────────────────────────────
  if (action === "route") {
    if (ticket.assignedDepartmentId !== user.departmentId) {
      return NextResponse.json(
        { error: "You can only route tickets assigned to your department." },
        { status: 403 }
      );
    }
    if (!departmentId) {
      return NextResponse.json(
        { error: "departmentId is required for routing." },
        { status: 400 }
      );
    }
    const targetDept = await prisma.department.findUnique({
      where: { id: departmentId },
    });
    if (!targetDept) {
      return NextResponse.json(
        { error: "Target department not found." },
        { status: 404 }
      );
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        assignedDepartmentId: targetDept.id,
        assignedToId: null, // clear pick when routing
        status: "NEW", // reset status for the new department
      },
      include: ticketInclude,
    });
    return NextResponse.json(updated);
  }

  // ── Status update (only picked admin) ──────────────────────
  if (status) {
    if (ticket.assignedToId !== user.id) {
      return NextResponse.json(
        { error: "You must pick this ticket before updating its status." },
        { status: 403 }
      );
    }

    const validStatuses = ["NEW", "IN_PROGRESS", "RESOLVED", "DECLINED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: { status: status as never },
      include: ticketInclude,
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "No valid action or status provided." }, { status: 400 });
}
