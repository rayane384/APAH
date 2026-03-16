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
  routedTo: {
    select: { id: true, assignedDepartment: { select: { id: true, name: true, code: true } } },
  },
  routedFrom: {
    select: { id: true, assignedDepartment: { select: { id: true, name: true, code: true } } },
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
  reservationRequest: {
    include: {
      room: {
        include: {
          campus: { select: { id: true, name: true, code: true } },
          roomType: { select: { id: true, name: true, code: true } },
        },
      },
      campus: { select: { id: true, name: true, code: true } },
      approvedReservation: true,
    },
  },
};

/* ── Status workflow: valid transitions ──────────────────── */
const VALID_TRANSITIONS: Record<string, string[]> = {
  NEW: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "DECLINED"],
  RESOLVED: [],
  DECLINED: [],
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

  // ── Pick ───────────────────────────────────────────────────
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
    // Auto-advance status: NEW → IN_PROGRESS on pick; keep IN_PROGRESS if re-picked
    const newStatus = ticket.status === "NEW" ? "IN_PROGRESS" : ticket.status;
    const historyEntries = [
      prisma.ticketHistory.create({
        data: { ticketId: id, action: "PICKED", performedById: user.id },
      }),
    ];
    if (newStatus !== ticket.status) {
      historyEntries.push(
        prisma.ticketHistory.create({
          data: {
            ticketId: id,
            action: "STATUS_CHANGED",
            performedById: user.id,
            oldStatus: ticket.status,
            newStatus,
          },
        })
      );
    }
    const [updated] = await prisma.$transaction([
      prisma.ticket.update({
        where: { id },
        data: { assignedToId: user.id, status: newStatus as never },
        include: ticketInclude,
      }),
      ...historyEntries,
    ]);
    return NextResponse.json(updated);
  }

  // ── Unpick ─────────────────────────────────────────────────
  if (action === "unpick") {
    if (ticket.assignedToId !== user.id) {
      return NextResponse.json(
        { error: "You can only release tickets you picked." },
        { status: 403 }
      );
    }
    // Cannot unpick a ticket that is already resolved or declined
    if (ticket.status === "RESOLVED" || ticket.status === "DECLINED") {
      return NextResponse.json(
        { error: "Cannot release a ticket that is already resolved or declined." },
        { status: 400 }
      );
    }
    const [updated] = await prisma.$transaction([
      prisma.ticket.update({
        where: { id },
        data: { assignedToId: null },
        include: ticketInclude,
      }),
      prisma.ticketHistory.create({
        data: {
          ticketId: id,
          action: "UNPICKED",
          performedById: user.id,
        },
      }),
    ]);
    return NextResponse.json(updated);
  }

  // ── Route (triage) ────────────────────────────────────────
  // Clone approach: original ticket stays untouched in triage,
  // a new ticket is created for the target department.
  if (action === "route") {
    if (ticket.assignedDepartmentId !== user.departmentId) {
      return NextResponse.json(
        { error: "You can only route tickets assigned to your department." },
        { status: 403 }
      );
    }
    if (ticket.routedToId) {
      return NextResponse.json(
        { error: "This ticket has already been routed." },
        { status: 409 }
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
    const fromDeptId = ticket.assignedDepartmentId;

    // Create clone for target dept + link original → clone + record history on both
    const [clonedTicket] = await prisma.$transaction(async (tx) => {
      // 1. Create the cloned ticket for the target department
      const clone = await tx.ticket.create({
        data: {
          categoryId: ticket.categoryId,
          subtype: ticket.subtype,
          description: ticket.description,
          createdById: ticket.createdById,
          assignedDepartmentId: targetDept.id,
          status: "NEW",
          priority: ticket.priority,
          aiReason: ticket.aiReason,
        },
      });

      // 2. Link original → clone and auto-resolve the triage ticket
      await tx.ticket.update({
        where: { id },
        data: { routedToId: clone.id, status: "RESOLVED" },
      });

      // Record auto-status change on triage ticket
      await tx.ticketHistory.create({
        data: {
          ticketId: id,
          action: "STATUS_CHANGED",
          performedById: user.id,
          oldStatus: ticket.status,
          newStatus: "RESOLVED",
        },
      });

      // 3. Record ROUTED history on the original ticket only (triage's copy)
      await tx.ticketHistory.create({
        data: {
          ticketId: id,
          action: "ROUTED",
          performedById: user.id,
          fromDepartmentId: fromDeptId,
          toDepartmentId: targetDept.id,
        },
      });

      return [clone];
    });

    // Return the updated original ticket (with routedTo link)
    const updated = await prisma.ticket.findUnique({
      where: { id },
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

    // Enforce status workflow transitions
    const allowed = VALID_TRANSITIONS[ticket.status] ?? [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        {
          error: `Cannot change status from ${ticket.status} to ${status}. Allowed: ${
            allowed.length ? allowed.join(", ") : "none (terminal state)"
          }`,
        },
        { status: 400 }
      );
    }

    const [updated] = await prisma.$transaction([
      prisma.ticket.update({
        where: { id },
        data: { status: status as never },
        include: ticketInclude,
      }),
      prisma.ticketHistory.create({
        data: {
          ticketId: id,
          action: "STATUS_CHANGED",
          performedById: user.id,
          oldStatus: ticket.status,
          newStatus: status,
        },
      }),
    ]);
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "No valid action or status provided." }, { status: 400 });
}
