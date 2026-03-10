import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/tickets/[id]/history
 * Returns the action history for a ticket.
 * Only accessible by admins of the assigned department (receivers).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      assignedDepartmentId: true,
      // Also check if this ticket was ever routed from user's dept (triage history)
      history: {
        where: { action: "ROUTED" },
        select: { fromDepartmentId: true },
      },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  // Only admins of the currently assigned department (or a department that routed this ticket) can see history
  const isDeptAdmin = isAdmin(user) && ticket.assignedDepartmentId === user.departmentId;
  const wasRoutedFrom =
    isAdmin(user) &&
    ticket.history.some((h) => h.fromDepartmentId === user.departmentId);

  if (!isDeptAdmin && !wasRoutedFrom) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const history = await prisma.ticketHistory.findMany({
    where: { ticketId: id },
    include: {
      performedBy: {
        select: { id: true, fullName: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(history);
}
