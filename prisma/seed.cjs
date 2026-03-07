require('dotenv').config();
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const cuid = require('cuid');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set in environment');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  const users = [
    {
      email: 'admin@example.com',
      password: 'AdminPass123!',
      fullName: 'Admin User',
      role: 'ADMIN',
      profile: null,
    },
    {
      email: 'prof@example.com',
      password: 'ProfPass123!',
      fullName: 'Prof User',
      role: 'NON_ADMIN',
      profile: 'PROF',
    },
    {
      email: 'delegue@example.com',
      password: 'DelegatePass123!',
      fullName: 'Delegue User',
      role: 'NON_ADMIN',
      profile: 'DELEGUE',
    },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    const id = cuid();
    await client.query(
      `INSERT INTO "User" (id, email, "password", "fullName", role, profile, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT (email) DO UPDATE SET
         "password" = EXCLUDED."password",
         "fullName" = EXCLUDED."fullName",
         role = EXCLUDED.role,
         profile = EXCLUDED.profile,
         "updatedAt" = now()`,
      [id, u.email, hashed, u.fullName, u.role, u.profile]
    );
    console.log(`Seeded user: ${u.email}`);
  }

  await client.end();
  console.log('Seeding complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
