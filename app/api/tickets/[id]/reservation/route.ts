import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/tickets/[id]/reservation
 * Admin actions on a reservation ticket: accept, decline, override.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Only admins can manage reservations." }, { status: 403 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      category: true,
      reservationRequest: {
        include: {
          room: { include: { campus: true } },
        },
      },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (!ticket.category.isReservation || !ticket.reservationRequest) {
    return NextResponse.json({ error: "This ticket is not a reservation ticket." }, { status: 400 });
  }
  if (ticket.assignedDepartmentId !== user.departmentId) {
    return NextResponse.json(
      { error: "You can only manage reservations assigned to your department." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { action, adminNote, roomId, startAt, endAt, campusId } = body as {
    action: "accept" | "decline" | "override" | "cancel";
    adminNote?: string;
    roomId?: string;
    startAt?: string;
    endAt?: string;
    campusId?: string;
  };

  const rr = ticket.reservationRequest;

  if (action === "accept" && rr.status !== "PENDING") {
    return NextResponse.json(
      { error: `Cannot accept: this request is already processed (${rr.status}).` },
      { status: 400 }
    );
  }
  if (action === "decline" && rr.status !== "PENDING") {
    return NextResponse.json(
      { error: `Cannot decline: this request is already processed (${rr.status}). Use cancel instead.` },
      { status: 400 }
    );
  }

  if (ticket.assignedToId !== user.id) {
    return NextResponse.json(
      { error: "You must pick this ticket before managing this reservation." },
      { status: 403 }
    );
  }

  // ── ACCEPT ─────────────────────────────────────────────────────
  if (action === "accept") {
    const reservationDescription = `Approved reservation from ticket ${ticket.id.slice(-8).toUpperCase()}`;

    // Check for conflicting approved reservations
    const conflict = await prisma.reservation.findFirst({
      where: {
        roomId: rr.roomId,
        status: "APPROVED",
        startAt: { lt: rr.endAt },
        endAt: { gt: rr.startAt },
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Cannot accept: an approved reservation already occupies this slot." },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const datesToBook: { startAt: Date; endAt: Date }[] = [];
      datesToBook.push({ startAt: rr.startAt, endAt: rr.endAt });

      if (rr.isRecurring && rr.recurrenceEndDate) {
        let nextStart = new Date(rr.startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        let nextEnd = new Date(rr.endAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        while (nextStart <= rr.recurrenceEndDate) {
          datesToBook.push({ startAt: new Date(nextStart), endAt: new Date(nextEnd) });
          nextStart.setTime(nextStart.getTime() + 7 * 24 * 60 * 60 * 1000);
          nextEnd.setTime(nextEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }

      for (let i = 0; i < datesToBook.length; i++) {
        const d = datesToBook[i];
        if (i > 0) {
          const conflict = await tx.reservation.findFirst({
            where: {
              roomId: rr.roomId,
              status: "APPROVED",
              startAt: { lt: d.endAt },
              endAt: { gt: d.startAt },
            },
          });
          if (conflict) {
            throw new Error(`Cannot accept: slot conflicts on ${d.startAt.toDateString()}.`);
          }
        }
      }

      const reservation = await tx.reservation.create({
        data: {
          kind: "MANUAL",
          status: "APPROVED",
          roomId: rr.roomId,
          campusId: rr.campusId,
          startAt: rr.startAt,
          endAt: rr.endAt,
          description: reservationDescription,
          createdFromRequestId: rr.id,
          createdById: user.id,
          isRecurring: rr.isRecurring,
          recurrenceEndDate: rr.recurrenceEndDate,
        },
      });

      // Update reservation request
      await tx.reservationRequest.update({
        where: { id: rr.id },
        data: {
          status: "ACCEPTED",
          processedById: user.id,
          processedAt: new Date(),
          adminNote: null,
          approvedReservationId: reservation.id,
        },
      });

      // Update ticket status
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: "IN_PROGRESS", assignedToId: user.id },
      });

      // Record history
      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: "RESERVATION_ACCEPTED",
          performedById: user.id,
        },
      });
      if (ticket.status !== "IN_PROGRESS") {
        await tx.ticketHistory.create({
          data: {
            ticketId: ticket.id,
            action: "STATUS_CHANGED",
            performedById: user.id,
            oldStatus: ticket.status,
            newStatus: "IN_PROGRESS",
          },
        });
      }

    });

    const updated = await prisma.ticket.findUnique({
      where: { id },
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
            room: { include: { campus: true, roomType: true } },
            campus: true,
            approvedReservation: {
              include: { room: true, campus: true }
            },
          },
        },
      },
    });

    return NextResponse.json(updated);
  }

  // ── DECLINE ────────────────────────────────────────────────────
  if (action === "decline") {
    if (!adminNote?.trim()) {
      return NextResponse.json({ error: "Admin note is required when declining." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.reservationRequest.update({
        where: { id: rr.id },
        data: {
          status: "DECLINED",
          processedById: user.id,
          processedAt: new Date(),
          adminNote: adminNote.trim(),
        },
      });

      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: "DECLINED", assignedToId: user.id },
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: "RESERVATION_DECLINED",
          performedById: user.id,
        },
      });
      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: "STATUS_CHANGED",
          performedById: user.id,
          oldStatus: ticket.status,
          newStatus: "DECLINED",
        },
      });
    });

    const updated = await prisma.ticket.findUnique({
      where: { id },
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
            room: { include: { campus: true, roomType: true } },
            campus: true,
            approvedReservation: {
              include: { room: true, campus: true }
            },
          },
        },
      },
    });

    return NextResponse.json(updated);
  }

  // ── OVERRIDE ───────────────────────────────────────────────────
  if (action === "override") {
    if (!roomId || !startAt || !endAt) {
      return NextResponse.json({ error: "Override requires roomId, startAt, and endAt." }, { status: 400 });
    }

    const reservationDescription = `Overridden reservation from ticket ${ticket.id.slice(-8).toUpperCase()}`;

    // Override uses provided values or falls back to original
    const overrideRoomId = roomId;
    const overrideStart = new Date(startAt);
    const overrideEnd = new Date(endAt);

    if (Number.isNaN(overrideStart.getTime()) || Number.isNaN(overrideEnd.getTime()) || overrideStart >= overrideEnd) {
      return NextResponse.json({ error: "Invalid override time range." }, { status: 400 });
    }

    // Determine campus: use provided, or look up from overridden room
    let overrideCampusId = campusId || rr.campusId;
    if (roomId !== rr.roomId) {
      const overrideRoom = await prisma.room.findUnique({
        where: { id: roomId },
        select: { campusId: true },
      });
      if (!overrideRoom) {
        return NextResponse.json({ error: "Override room not found." }, { status: 404 });
      }
      overrideCampusId = campusId || overrideRoom.campusId;
    }

    // Check for conflicts on the override slot, excluding its current approved reservation
    const conflict = await prisma.reservation.findFirst({
      where: {
        roomId: overrideRoomId,
        status: "APPROVED",
        startAt: { lt: overrideEnd },
        endAt: { gt: overrideStart },
        id: rr.approvedReservationId ? { not: rr.approvedReservationId } : undefined,
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Cannot override: the target slot already has an approved reservation." },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      const datesToBook: { startAt: Date; endAt: Date }[] = [];
      datesToBook.push({ startAt: overrideStart, endAt: overrideEnd });

      if (rr.isRecurring && rr.recurrenceEndDate) {
        let nextStart = new Date(overrideStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        let nextEnd = new Date(overrideEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
        while (nextStart <= rr.recurrenceEndDate) {
          datesToBook.push({ startAt: new Date(nextStart), endAt: new Date(nextEnd) });
          nextStart.setTime(nextStart.getTime() + 7 * 24 * 60 * 60 * 1000);
          nextEnd.setTime(nextEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }

      for (let i = 0; i < datesToBook.length; i++) {
        const d = datesToBook[i];
        if (i > 0) {
          const conflict = await tx.reservation.findFirst({
            where: {
              roomId: overrideRoomId,
              status: "APPROVED",
              startAt: { lt: d.endAt },
              endAt: { gt: d.startAt },
              id: rr.approvedReservationId ? { not: rr.approvedReservationId } : undefined,
            },
          });
          if (conflict) {
            throw new Error(`Cannot override: slot conflicts on ${d.startAt.toDateString()}.`);
          }
        }
      }

      // Delete existing reservation if replacing an already-approved one
      if (rr.approvedReservationId) {
        await tx.reservation.delete({
          where: { id: rr.approvedReservationId }
        });
      }

      const reservation = await tx.reservation.create({
        data: {
          kind: "MANUAL",
          status: "APPROVED",
          roomId: overrideRoomId,
          campusId: overrideCampusId,
          startAt: overrideStart,
          endAt: overrideEnd,
          description: reservationDescription,
          createdFromRequestId: rr.id,
          createdById: user.id,
          isRecurring: rr.isRecurring,
          recurrenceEndDate: rr.recurrenceEndDate,
        },
      });

      await tx.reservationRequest.update({
        where: { id: rr.id },
        data: {
          status: "OVERRIDDEN",
          processedById: user.id,
          processedAt: new Date(),
          adminNote: null,
          approvedReservationId: reservation.id,
        },
      });

      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: "IN_PROGRESS", assignedToId: user.id },
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: "RESERVATION_OVERRIDDEN",
          performedById: user.id,
        },
      });

      if (ticket.status !== "IN_PROGRESS") {
        await tx.ticketHistory.create({
          data: {
            ticketId: ticket.id,
            action: "STATUS_CHANGED",
            performedById: user.id,
            oldStatus: ticket.status,
            newStatus: "IN_PROGRESS",
          },
        });
      }
    });

    const updated = await prisma.ticket.findUnique({
      where: { id },
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
            room: { include: { campus: true, roomType: true } },
            campus: true,
            approvedReservation: {
              include: { room: true, campus: true }
            },
          },
        },
      },
    });

    return NextResponse.json(updated);
  }

  // ── CANCEL ─────────────────────────────────────────────────────
  if (action === "cancel") {
    if (rr.status !== "ACCEPTED" && rr.status !== "OVERRIDDEN") {
      return NextResponse.json({ error: "Only accepted or overridden reservations can be cancelled." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (rr.approvedReservationId) {
        await tx.reservation.delete({ where: { id: rr.approvedReservationId } });
      }

      await tx.reservationRequest.update({
        where: { id: rr.id },
        data: {
          status: "CANCELLED",
          processedById: user.id,
          processedAt: new Date(),
          adminNote: adminNote?.trim() || "Cancelled by admin",
          approvedReservationId: null,      // Ensure it is disconnected
        },
      });

      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: "DECLINED", assignedToId: user.id },
      });

      await tx.ticketHistory.create({
        data: {
          ticketId: ticket.id,
          action: "RESERVATION_CANCELLED",
          performedById: user.id,
        },
      });

      if (ticket.status !== "DECLINED") {
        await tx.ticketHistory.create({
          data: {
            ticketId: ticket.id,
            action: "STATUS_CHANGED",
            performedById: user.id,
            oldStatus: ticket.status,
            newStatus: "DECLINED",
          },
        });
      }
    });

    const updated = await prisma.ticket.findUnique({
      where: { id },
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
            room: { include: { campus: true, roomType: true } },
            campus: true,
            approvedReservation: {
              include: { room: true, campus: true }
            },
          },
        },
      },
    });

    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Invalid action. Use: accept, decline, override, or cancel." }, { status: 400 });
}
