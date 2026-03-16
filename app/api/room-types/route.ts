import { NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";
import { getCurrentUser } from "../../lib/auth-helpers";

/**
 * GET /api/room-types
 * Returns all room types.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roomTypes = await prisma.roomType.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(roomTypes);
}
