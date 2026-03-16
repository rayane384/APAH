import { NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";
import { getCurrentUser } from "../../lib/auth-helpers";

/**
 * GET /api/campuses
 * Returns all campuses.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campuses = await prisma.campus.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(campuses);
}
