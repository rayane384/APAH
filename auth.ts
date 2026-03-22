import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { PrismaClient } from "./app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

type NextAuthUser = {
  id: string;
  role?: string;
  profile?: string | null;
  departmentId?: string | null;
  isReservationAdmin?: boolean;
};

type NextAuthToken = Record<string, unknown>;

type AuthorizedUser = {
  id: string;
  email: string;
  name?: string | null;
  role?: string;
  profile?: string | null;
  departmentId?: string | null;
  isReservationAdmin?: boolean;
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

function getPrisma() {
  return prisma;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials?.email ?? "").toString().toLowerCase().trim();
        const password = (credentials?.password ?? "").toString();

        if (!email || !password) return null;

        try {
          const db = getPrisma();
          const user = await db.user.findUnique({ where: { email } });
          if (!user) return null;

          const ok = await bcrypt.compare(password, user.password);
          if (!ok) return null;

          let isReservationAdmin = false;
          if (user.role === "ADMIN" && user.departmentId) {
            const resCategory = await db.category.findFirst({
              where: { ownerDepartmentId: user.departmentId, isReservation: true },
            });
            isReservationAdmin = !!resCategory;
          }

          // Ce que NextAuth mettra dans le token "user"
          return {
            id: user.id,
            email: user.email,
            name: user.fullName,
            role: user.role,
            profile: user.profile,
            departmentId: user.departmentId,
            isReservationAdmin,
          } as AuthorizedUser;
        } catch (err) {
          console.error("[AUTH] authorize error:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as NextAuthUser;
        const t = token as unknown as NextAuthToken;
        t.id = u.id;
        if (u.role !== undefined) t.role = u.role;
        if (u.profile !== undefined) t.profile = u.profile;
        if (u.departmentId !== undefined) t.departmentId = u.departmentId;
        if (u.isReservationAdmin !== undefined) t.isReservationAdmin = u.isReservationAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      const s = session as unknown as { user: Record<string, unknown> };
      const t = token as unknown as NextAuthToken;
      if (t.id) s.user.id = String(t.id);
      if (t.role) s.user.role = String(t.role);
      if (t.profile) s.user.profile = String(t.profile);
      if (t.departmentId) s.user.departmentId = String(t.departmentId);
      if (t.isReservationAdmin !== undefined) s.user.isReservationAdmin = Boolean(t.isReservationAdmin);
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as handlers };