import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      role?: string;
      profile?: string | null;
      departmentId?: string | null;
      isReservationAdmin?: boolean;
    };
  }
}
