import { NextResponse } from "next/server";
import { prisma } from "../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../lib/auth-helpers";

/**
 * GET /api/categories
 * Returns categories visible to the current user based on their role/profile/department.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Build the visibility filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visibilityFilter: any[] = [];

  if (isAdmin(user)) {
    // Admins can see ALL categories so they can send tickets to any department
    const categories = await prisma.category.findMany({
      include: {
        ownerDepartment: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ isOther: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(categories);
  }

  // Non-admin sees categories visible to their profile
  if (user.profile) {
    visibilityFilter.push({ profile: user.profile });
  }

  // "Other" category is always visible to everyone
  const categories = await prisma.category.findMany({
    where: {
      OR: [
        { visibilities: { some: { OR: visibilityFilter } } },
        { isOther: true },
      ],
    },
    include: {
      ownerDepartment: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ isOther: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(categories);
}
