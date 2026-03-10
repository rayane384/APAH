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
      // All: assigned to department OR sent by any admin in department
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

  // Reservation category not handled here (future feature)
  if (category.isReservation) {
    return NextResponse.json(
      { error: "Reservation tickets are not yet supported. Coming soon." },
      { status: 400 }
    );
  }

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
