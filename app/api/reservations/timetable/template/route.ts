import { NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "../../../../lib/auth-helpers";
import * as XLSX from "xlsx";
import { prisma } from "../../../../lib/prisma";

/**
 * GET /api/reservations/timetable/template
 * Generates a flat Excel template with example group data.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rooms = await prisma.room.findMany({
    include: { campus: true },
    orderBy: [{ campus: { name: "asc" } }, { name: "asc" }],
    take: 6,
  });

  if (rooms.length === 0) {
    return NextResponse.json(
      { error: "No rooms found in the system. Please create rooms before downloading a prefilled template." },
      { status: 400 }
    );
  }

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();

  // Flat data template: one row = one slot reservation
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const times = [
    ["08:30", "10:30"],
    ["10:30", "12:00"],
    ["12:30", "13:45"],
    ["14:30", "16:15"],
    ["16:30", "18:00"],
    ["10:45", "12:45"],
  ] as const;
  const subjects = [
    "Mathematics - Group A1",
    "Computer Science - Group B2",
    "Physics - Group A1",
    "English - Group C1",
    "Project Session - Group A1",
    "Workshop - Group D3",
  ];

  const sampleRows = days.map((day, index) => {
    const room = rooms[index % rooms.length];
    return [
      day,
      times[index][0],
      times[index][1],
      subjects[index],
      `${room.code} / ${room.campus.name}`,
    ];
  });

  const templateData = [
    ["Day of Week", "Start Time", "End Time", "Subject / Description / Group", "Room / Campus"],
    ...sampleRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(templateData);

  // Set column widths for better UX
  ws["!cols"] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 42 },
    { wch: 30 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "FlatTemplate");

  // Write the workbook to a buffer
  const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  // Return the file with proper headers for download
  return new NextResponse(excelBuffer, {
    status: 200,
    headers: {
      "Content-Disposition": 'attachment; filename="Timetable_Flat_Template_Example_Group.xlsx"',
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
