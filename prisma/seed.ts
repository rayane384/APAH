import bcrypt from "bcrypt";
let prisma: any;

async function main() {
  // Import the generated client
  const mod = (await import("../app/generated/prisma/client")) as any;
  const PrismaClientCtor: any = mod.PrismaClient ?? mod.default ?? mod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma = new PrismaClientCtor({} as unknown as any);
  const users = [
    {
      email: "admin@example.com",
      password: "AdminPass123!",
      fullName: "Admin User",
      role: "ADMIN",
      profile: null,
    },
    {
      email: "prof@example.com",
      password: "ProfPass123!",
      fullName: "Prof User",
      role: "NON_ADMIN",
      profile: "PROF",
    },
    {
      email: "delegue@example.com",
      password: "DelegatePass123!",
      fullName: "Delegue User",
      role: "NON_ADMIN",
      profile: "DELEGUE",
    },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    // upsert to avoid duplicates when re-running
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        password: hashed,
        role: u.role as any,
        profile: u.profile as any,
      },
      create: {
        email: u.email,
        fullName: u.fullName,
        password: hashed,
        role: u.role as any,
        profile: u.profile as any,
      },
    });
    console.log(`Seeded user: ${u.email}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seeding complete.");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
