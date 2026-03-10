import bcrypt from "bcrypt";
import "dotenv/config";
import pg from "pg";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;

async function main() {
  const mod = (await import("../app/generated/prisma/client")) as any;
  const PrismaClientCtor: any = mod.PrismaClient ?? mod.default ?? mod;
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClientCtor({ adapter });

  // ── 1. Departments ──────────────────────────────────────────────
  const departments = [
    { name: "IT Support", code: "IT" },
    { name: "Facilities", code: "FAC" },
    { name: "Administration", code: "ADM" },
    { name: "Reservation", code: "RESV" },
    { name: "Escalation / Triage", code: "TRIAGE" },
  ];

  const deptMap: Record<string, any> = {};
  for (const d of departments) {
    deptMap[d.code] = await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name },
      create: { name: d.name, code: d.code },
    });
    console.log(`  Dept: ${d.code}`);
  }

  // ── 2. Users (with department for admins) ──────────────────────
  const users = [
    {
      email: "admin-it@example.com",
      password: "AdminPass123!",
      fullName: "Admin IT",
      role: "ADMIN",
      profile: null,
      departmentCode: "IT",
    },
    {
      email: "admin-it2@example.com",
      password: "AdminPass123!",
      fullName: "Admin IT 2",
      role: "ADMIN",
      profile: null,
      departmentCode: "IT",
    },
    {
      email: "admin-fac@example.com",
      password: "AdminPass123!",
      fullName: "Admin Facilities",
      role: "ADMIN",
      profile: null,
      departmentCode: "FAC",
    },
    {
      email: "admin-fac2@example.com",
      password: "AdminPass123!",
      fullName: "Admin Facilities 2",
      role: "ADMIN",
      profile: null,
      departmentCode: "FAC",
    },
    {
      email: "admin-adm@example.com",
      password: "AdminPass123!",
      fullName: "Admin Administration",
      role: "ADMIN",
      profile: null,
      departmentCode: "ADM",
    },
    {
      email: "admin-adm2@example.com",
      password: "AdminPass123!",
      fullName: "Admin Administration 2",
      role: "ADMIN",
      profile: null,
      departmentCode: "ADM",
    },
    {
      email: "admin-resv@example.com",
      password: "AdminPass123!",
      fullName: "Admin Reservation",
      role: "ADMIN",
      profile: null,
      departmentCode: "RESV",
    },
    {
      email: "admin-resv2@example.com",
      password: "AdminPass123!",
      fullName: "Admin Reservation 2",
      role: "ADMIN",
      profile: null,
      departmentCode: "RESV",
    },
    {
      email: "admin-triage@example.com",
      password: "AdminPass123!",
      fullName: "Admin Triage",
      role: "ADMIN",
      profile: null,
      departmentCode: "TRIAGE",
    },
    {
      email: "admin-triage2@example.com",
      password: "AdminPass123!",
      fullName: "Admin Triage 2",
      role: "ADMIN",
      profile: null,
      departmentCode: "TRIAGE",
    },
    {
      email: "prof@example.com",
      password: "ProfPass123!",
      fullName: "Prof User",
      role: "NON_ADMIN",
      profile: "PROF",
      departmentCode: null,
    },
    {
      email: "delegue@example.com",
      password: "DelegatePass123!",
      fullName: "Delegue User",
      role: "NON_ADMIN",
      profile: "DELEGUE",
      departmentCode: null,
    },
    {
      email: "club@example.com",
      password: "ClubPass123!",
      fullName: "Club President",
      role: "NON_ADMIN",
      profile: "CLUB_PRESIDENT",
      departmentCode: null,
    },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        password: hashed,
        role: u.role as any,
        profile: u.profile as any,
        departmentId: u.departmentCode ? deptMap[u.departmentCode].id : null,
      },
      create: {
        email: u.email,
        fullName: u.fullName,
        password: hashed,
        role: u.role as any,
        profile: u.profile as any,
        departmentId: u.departmentCode ? deptMap[u.departmentCode].id : null,
      },
    });
    console.log(`  User: ${u.email}`);
  }

  // Remove old admin@example.com if it exists (legacy seed)
  await prisma.user.deleteMany({ where: { email: "admin@example.com" } });

  // ── 3. Categories ──────────────────────────────────────────────
  const categories = [
    {
      name: "Hardware Issue",
      code: "HW_ISSUE",
      ownerDeptCode: "IT",
      visibleTo: { profiles: ["PROF", "DELEGUE", "CLUB_PRESIDENT"], deptCodes: ["IT"] },
    },
    {
      name: "Software Issue",
      code: "SW_ISSUE",
      ownerDeptCode: "IT",
      visibleTo: { profiles: ["PROF", "DELEGUE", "CLUB_PRESIDENT"], deptCodes: ["IT"] },
    },
    {
      name: "Network / Connectivity",
      code: "NET_ISSUE",
      ownerDeptCode: "IT",
      visibleTo: { profiles: ["PROF", "DELEGUE"], deptCodes: ["IT"] },
    },
    {
      name: "Maintenance Request",
      code: "MAINT_REQ",
      ownerDeptCode: "FAC",
      visibleTo: { profiles: ["PROF", "DELEGUE", "CLUB_PRESIDENT"], deptCodes: ["FAC"] },
    },
    {
      name: "Cleaning Request",
      code: "CLEAN_REQ",
      ownerDeptCode: "FAC",
      visibleTo: { profiles: ["DELEGUE"], deptCodes: ["FAC"] },
    },
    {
      name: "Document Request",
      code: "DOC_REQ",
      ownerDeptCode: "ADM",
      visibleTo: { profiles: ["PROF", "DELEGUE", "CLUB_PRESIDENT"], deptCodes: ["ADM"] },
    },
    {
      name: "Grade Issue",
      code: "GRADE_ISSUE",
      ownerDeptCode: "ADM",
      visibleTo: { profiles: ["PROF", "DELEGUE"], deptCodes: ["ADM"] },
    },
    {
      name: "Reservation",
      code: "RESERVATION",
      ownerDeptCode: "RESV",
      isReservation: true,
      visibleTo: { profiles: ["PROF", "DELEGUE", "CLUB_PRESIDENT"], deptCodes: ["RESV"] },
    },
    {
      name: "Other",
      code: "OTHER",
      ownerDeptCode: "TRIAGE",
      isOther: true,
      visibleTo: {
        profiles: ["PROF", "DELEGUE", "CLUB_PRESIDENT"],
        deptCodes: ["IT", "FAC", "ADM", "RESV", "TRIAGE"],
      },
    },
  ];

  for (const cat of categories) {
    const ownerDept = deptMap[cat.ownerDeptCode];
    const created = await prisma.category.upsert({
      where: { code: cat.code },
      update: {
        name: cat.name,
        ownerDepartmentId: ownerDept.id,
        isOther: (cat as any).isOther ?? false,
        isReservation: (cat as any).isReservation ?? false,
      },
      create: {
        name: cat.name,
        code: cat.code,
        ownerDepartmentId: ownerDept.id,
        isOther: (cat as any).isOther ?? false,
        isReservation: (cat as any).isReservation ?? false,
      },
    });

    await prisma.categoryVisibility.deleteMany({
      where: { categoryId: created.id },
    });

    for (const profile of cat.visibleTo.profiles) {
      await prisma.categoryVisibility.create({
        data: { categoryId: created.id, profile: profile as any, departmentId: null },
      });
    }

    for (const dCode of cat.visibleTo.deptCodes) {
      await prisma.categoryVisibility.create({
        data: { categoryId: created.id, profile: null, departmentId: deptMap[dCode].id },
      });
    }

    console.log(`  Category: ${cat.code}`);
  }

  console.log("\nSeeding complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
