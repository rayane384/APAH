import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/auth-helpers";
import { isReservationDepartmentAdmin } from "../../../lib/reservation-admin";
import { Prisma } from "../../../generated/prisma/client";

/**
 * GET /api/reservations/manual-history
 * Reservation-admin only: list manual reservation records (approved + cancelled).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canAccess = await isReservationDepartmentAdmin(user);
  if (!canAccess) {
    return NextResponse.json({ error: "Only reservation department admins can view manual history." }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));
  const status = searchParams.get("status");

  const where: Prisma.ReservationWhereInput = {
    kind: "MANUAL" as const,
    ...(status === "APPROVED" || status === "CANCELLED" ? { status } : {}),
  };

  const [total, reservations] = await Promise.all([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      include: {
        room: {
          include: {
            campus: { select: { id: true, name: true, code: true } },
            roomType: { select: { id: true, name: true, code: true } },
          },
        },
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: reservations,
  });
}
