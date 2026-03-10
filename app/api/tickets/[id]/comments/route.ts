import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/tickets/[id]/comments
 * Add a comment to a ticket.
 * Body: { body: string }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id: ticketId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  // Access check: creator or the admin who picked this ticket
  const isCreator = ticket.createdById === user.id;
  const isPickedAdmin = isAdmin(user) && ticket.assignedToId === user.id;

  if (!isCreator && !isPickedAdmin) {
    return NextResponse.json(
      { error: "Only the ticket creator or the admin who picked this ticket can comment." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { body: commentBody } = body as { body: string };

  if (!commentBody?.trim()) {
    return NextResponse.json({ error: "Comment body is required." }, { status: 400 });
  }

  const comment = await prisma.ticketComment.create({
    data: {
      ticketId,
      authorId: user.id,
      body: commentBody.trim(),
    },
    include: {
      author: { select: { id: true, fullName: true, role: true } },
    },
  });

  return NextResponse.json(comment, { status: 201 });
}
