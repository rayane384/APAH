import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getCurrentUser } from "../../../../lib/auth-helpers";
import path from "path";
import fs from "fs/promises";

type Params = { params: Promise<{ id: string }> };

const MAX_FILES_PER_TICKET = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv",
]);

/**
 * GET /api/tickets/[id]/attachments
 * List attachments for a ticket.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attachments = await prisma.ticketAttachment.findMany({
    where: { ticketId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(attachments);
}

/**
 * POST /api/tickets/[id]/attachments
 * Upload files for a ticket (multipart form data).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ticket exists
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  // Check existing attachment count
  const existingCount = await prisma.ticketAttachment.count({
    where: { ticketId: id },
  });

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files provided." }, { status: 400 });
  }

  if (existingCount + files.length > MAX_FILES_PER_TICKET) {
    return NextResponse.json(
      { error: `Maximum ${MAX_FILES_PER_TICKET} files per ticket. Currently ${existingCount} attached.` },
      { status: 400 }
    );
  }

  // Validate each file
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds the 10 MB limit.` },
        { status: 400 }
      );
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `File type "${ext}" is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}` },
        { status: 400 }
      );
    }

    if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
      // Still allow if extension is valid (some browsers don't set mime properly)
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return NextResponse.json(
          { error: `File type "${file.type}" is not allowed.` },
          { status: 400 }
        );
      }
    }
  }

  // Create upload directory
  const uploadDir = path.join(process.cwd(), "public", "uploads", "tickets", id);
  await fs.mkdir(uploadDir, { recursive: true });

  const created = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeFileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadDir, safeFileName);

    await fs.writeFile(filePath, buffer);

    const attachment = await prisma.ticketAttachment.create({
      data: {
        ticketId: id,
        fileName: file.name,
        filePath: `/uploads/tickets/${id}/${safeFileName}`,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      },
    });

    created.push(attachment);
  }

  return NextResponse.json(created, { status: 201 });
}
