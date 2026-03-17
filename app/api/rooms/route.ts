import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../lib/auth-helpers";

/**
 * GET /api/rooms?campusId=X&roomTypeId=Y
 * List rooms with optional campus/type filters.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const campusId = searchParams.get("campusId");
  const roomTypeId = searchParams.get("roomTypeId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (campusId) where.campusId = campusId;
  if (roomTypeId) where.roomTypeId = roomTypeId;

  const rooms = await prisma.room.findMany({
    where,
    include: {
      campus: { select: { id: true, name: true, code: true } },
      roomType: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ campus: { name: "asc" } }, { name: "asc" }],
  });

  return NextResponse.json(rooms);
}
