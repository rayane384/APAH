import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../lib/auth-helpers";

/**
 * GET /api/tickets
 * - ADMIN: returns tickets assigned to their department
 * - NON_ADMIN: returns tickets they created
 * Supports query params: ?status=NEW&sort=newest
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") ?? "newest";
  const direction = searchParams.get("direction"); // "sent" | "received" | "mine" | null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (isAdmin(user)) {
    if (direction === "sent") {
      // Tickets sent by any admin in this department
      where.createdBy = { departmentId: user.departmentId, role: "ADMIN" };
    } else if (direction === "received") {
      // Tickets assigned to the admin's department
      where.assignedDepartmentId = user.departmentId;
    } else if (direction === "mine") {
      // Tickets personally picked by this admin
      where.assignedToId = user.id;
    } else {
      // All: assigned to department OR sent by dept admins
      where.OR = [
        { assignedDepartmentId: user.departmentId },
        { createdBy: { departmentId: user.departmentId, role: "ADMIN" } },
      ];
    }
  } else {
    // Non-admin sees only their own tickets
    where.createdById = user.id;
  }

  if (status) {
    where.status = status;
  }

  const orderBy =
    sort === "oldest" ? { createdAt: "asc" as const } : { createdAt: "desc" as const };

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, code: true, isReservation: true, isOther: true } },
      createdBy: {
        select: {
          id: true, fullName: true, email: true, role: true, profile: true,
          department: { select: { id: true, name: true, code: true } },
        },
      },
      assignedDepartment: { select: { id: true, name: true, code: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      _count: { select: { comments: true } },
    },
    orderBy,
  });

  return NextResponse.json(tickets);
}

/**
 * POST /api/tickets
 * Create a new ticket. Body: { categoryId, subtype?, description }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { categoryId, subtype, description, assignedDepartmentId: targetDeptId } = body as {
    categoryId: string;
    subtype?: string;
    description: string;
    assignedDepartmentId?: string;
  };

  if (!categoryId || !description?.trim()) {
    return NextResponse.json(
      { error: "categoryId and description are required." },
      { status: 400 }
    );
  }

  // Verify category exists & get owner department
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { ownerDepartment: true },
  });

  if (!category) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  // ── Reservation ticket flow ──────────────────────────────
  if (category.isReservation) {
    const { roomId, startAt, endAt, adminCanAdjust, periodOfDay } = body as {
      roomId?: string;
      startAt?: string;
      endAt?: string;
      adminCanAdjust?: boolean;
      periodOfDay?: string;
    };

    if (!roomId || !startAt || !endAt) {
      return NextResponse.json(
        { error: "roomId, startAt, and endAt are required for reservation tickets." },
        { status: 400 }
      );
    }

    const start = new Date(startAt);
    const end = new Date(endAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid startAt or endAt date." }, { status: 400 });
    }
    if (start >= end) {
      return NextResponse.json({ error: "startAt must be before endAt." }, { status: 400 });
    }

    // Validate room exists and get its campus
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, campusId: true },
    });
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    // Check for conflicting approved reservations
    const conflict = await prisma.reservation.findFirst({
      where: {
        roomId: room.id,
        status: "APPROVED",
        startAt: { lt: end },
        endAt: { gt: start },
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "This slot is already reserved (approved reservation exists)." },
        { status: 409 }
      );
    }

    // Compute slot start minute for demand tracking
    const slotStartMinute = start.getUTCHours() * 60 + start.getUTCMinutes();
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

    // Transaction: create ticket + reservation request + upsert demand
    const result = await prisma.$transaction(async (tx) => {
      const newTicket = await tx.ticket.create({
        data: {
          categoryId: category.id,
          subtype: subtype?.trim() || null,
          description: description.trim(),
          createdById: user.id,
          assignedDepartmentId: category.ownerDepartmentId,
          status: "NEW",
        },
      });

      await tx.reservationRequest.create({
        data: {
          ticketId: newTicket.id,
          roomId: room.id,
          campusId: room.campusId,
          startAt: start,
          endAt: end,
          adminCanAdjust: adminCanAdjust ?? false,
          periodOfDay: (periodOfDay as "ANY" | "BEFORE_MIDDAY" | "AFTER_MIDDAY") ?? "ANY",
          status: "PENDING",
        },
      });

      // Upsert historical demand counter
      await tx.roomSlotDemand.upsert({
        where: {
          roomId_slotStartMinute_durationMinutes: {
            roomId: room.id,
            slotStartMinute,
            durationMinutes,
          },
        },
        update: {
          requestCount: { increment: 1 },
          lastRequestedAt: new Date(),
        },
        create: {
          roomId: room.id,
          slotStartMinute,
          durationMinutes,
          requestCount: 1,
          lastRequestedAt: new Date(),
        },
      });

      return newTicket;
    });

    // Re-fetch with full includes
    const created = await prisma.ticket.findUnique({
      where: { id: result.id },
      include: {
        category: { select: { id: true, name: true, code: true, isReservation: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        assignedDepartment: { select: { id: true, name: true, code: true } },
        reservationRequest: {
          include: {
            room: { include: { campus: true, roomType: true } },
            campus: true,
          },
        },
      },
    });

    return NextResponse.json(created, { status: 201 });
  }

  // ── Standard ticket flow ───────────────────────────────────
  // Admins can manually select a target department; non-admins always use category default
  let assignedDepartmentId = category.ownerDepartmentId;
  if (targetDeptId && isAdmin(user)) {
    const dept = await prisma.department.findUnique({ where: { id: targetDeptId } });
    if (!dept) {
      return NextResponse.json({ error: "Target department not found." }, { status: 404 });
    }
    assignedDepartmentId = dept.id;
  }

  // Create the ticket
  const ticket = await prisma.ticket.create({
    data: {
      categoryId: category.id,
      subtype: subtype?.trim() || null,
      description: description.trim(),
      createdById: user.id,
      assignedDepartmentId,
      status: "NEW",
    },
    include: {
      category: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, fullName: true, email: true } },
      assignedDepartment: { select: { id: true, name: true, code: true } },
    },
  });

  return NextResponse.json(ticket, { status: 201 });
}
