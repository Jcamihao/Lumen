import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { buildExportPayload } from "./export-payload";
import { exportUserQuery } from "./export-user.query";

export class UserExporter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly isMfaEnabled: () => boolean,
  ) {}

  async exportMe(userId: string) {
    const user = await this.prisma.user.findUnique(exportUserQuery(userId));
    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }
    return buildExportPayload(user, this.isMfaEnabled());
  }
}
