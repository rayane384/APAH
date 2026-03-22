import { prisma } from "./prisma";
import { SessionUser, isAdmin } from "./auth-helpers";

export async function isReservationDepartmentAdmin(user: SessionUser): Promise<boolean> {
  if (!isAdmin(user) || !user.departmentId) {
    return false;
  }

  const reservationCategory = await prisma.category.findFirst({
    where: {
      ownerDepartmentId: user.departmentId,
      isReservation: true,
    },
    select: { id: true },
  });

  return !!reservationCategory;
}
