import { PrismaService } from '../../prisma/prisma.service';

export function findUserTimezone(prisma: PrismaService, userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
}

export function findUserProfile(prisma: PrismaService, userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      preferredCurrency: true,
      monthlyIncome: true,
      birthDate: true,
      occupation: true,
      primaryGoal: true,
    },
  });
}
