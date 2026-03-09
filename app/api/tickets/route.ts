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
  const direction = searchParams.get("direction"); // "sent" | "received" | null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (isAdmin(user)) {
    if (direction === "sent") {
      // Only tickets the admin created
      where.createdById = user.id;
    } else if (direction === "received") {
      // Only tickets assigned to the admin's department
      where.assignedDepartmentId = user.departmentId;
    } else {
      // All: assigned to department OR created by admin
      where.OR = [
        { assignedDepartmentId: user.departmentId },
        { createdById: user.id },
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
      createdBy: { select: { id: true, fullName: true, email: true, role: true, profile: true } },
      assignedDepartment: { select: { id: true, name: true, code: true } },
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
  const { categoryId, subtype, description } = body as {
    categoryId: string;
    subtype?: string;
    description: string;
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

  // Reservation category not handled here (future feature)
  if (category.isReservation) {
    return NextResponse.json(
      { error: "Reservation tickets are not yet supported. Coming soon." },
      { status: 400 }
    );
  }

  // Department is always determined by the category
  const assignedDepartmentId = category.ownerDepartmentId;

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
