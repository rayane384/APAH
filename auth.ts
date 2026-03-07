import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { PrismaClient } from "./app/generated/prisma/client";

type NextAuthUser = {
  id: string;
  role?: string;
  profile?: string | null;
  departmentId?: string | null;
};

type NextAuthToken = Record<string, unknown>;

type AuthorizedUser = {
  id: string;
  email: string;
  name?: string | null;
  role?: string;
  profile?: string | null;
  departmentId?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({} as unknown as any);

export const { handlers, auth } = NextAuth({
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

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;

        // Ce que NextAuth mettra dans le token "user"
        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          role: user.role,
          profile: user.profile,
          departmentId: user.departmentId,
        } as AuthorizedUser;
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
      return session;
    },
  },
});