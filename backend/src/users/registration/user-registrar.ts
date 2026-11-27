import { PrismaService } from "../../prisma/prisma.service";
import { buildDefaultFinanceCategories, buildDefaultTagGroups, buildDefaultTaskCategories } from "./default-catalog";
import { CreateUserInput } from "./create-user.input";
import { buildPrincipalCardData } from "./principal-card.data";
import { buildUserCreateData } from "./user-create.data";

export class UserRegistrar {
  constructor(private readonly prisma: PrismaService) {}

  /** User e cartao "Principal" (padrao) na mesma transacao (contrato item 9, secao 3). */
  createAccount(input: CreateUserInput) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: buildUserCreateData(input, now) });
      await tx.creditCard.create({
        data: buildPrincipalCardData(created.id, input.monthClosingDay),
      });
      return created;
    });
  }

  async seedDefaults(userId: string) {
    await Promise.all([
      this.prisma.taskCategory.createMany({ data: buildDefaultTaskCategories(userId) }),
      this.prisma.financeCategory.createMany({ data: buildDefaultFinanceCategories(userId) }),
      this.prisma.tagGroup.createMany({ data: buildDefaultTagGroups(userId) }),
    ]);
  }
}
