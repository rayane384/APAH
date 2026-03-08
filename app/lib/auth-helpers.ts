import { getServerSession } from "next-auth";
import { authOptions } from "../../auth";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  profile?: string | null;
  departmentId?: string | null;
};

/**
 * Server-side helper – returns the authenticated user or null.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return session.user as SessionUser;
}

/**
 * Returns true when the user has the ADMIN role.
 */
export function isAdmin(user: SessionUser): boolean {
  return user.role === "ADMIN";
}
