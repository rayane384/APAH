import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

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
    include: {
      category: { select: { id: true, name: true, code: true, isReservation: true, isOther: true } },
      createdBy: { select: { id: true, fullName: true, email: true, role: true, profile: true } },
      assignedDepartment: { select: { id: true, name: true, code: true } },
      comments: {
        include: {
          author: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      reservationRequest: true,
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  // Access check: creator can see their ticket, admin of assigned dept can see it
  const isCreator = ticket.createdById === user.id;
  const isAssignedAdmin = isAdmin(user) && ticket.assignedDepartmentId === user.departmentId;

  if (!isCreator && !isAssignedAdmin) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  return NextResponse.json(ticket);
}

/**
 * PATCH /api/tickets/[id]
 * Update ticket status (admin only for the assigned department).
 * Body: { status: "IN_PROGRESS" | "RESOLVED" | "DECLINED" }
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

  if (ticket.assignedDepartmentId !== user.departmentId) {
    return NextResponse.json(
      { error: "You can only update tickets assigned to your department." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { status } = body as { status: string };

  const validStatuses = ["NEW", "IN_PROGRESS", "RESOLVED", "DECLINED"];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Status must be one of: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  const updated = await prisma.ticket.update({
    where: { id },
    data: { status: status as never },
    include: {
      category: { select: { id: true, name: true, code: true } },
      assignedDepartment: { select: { id: true, name: true, code: true } },
    },
  });

  return NextResponse.json(updated);
}
