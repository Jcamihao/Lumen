import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";

export class AccountDeleter {
  constructor(private readonly prisma: PrismaService) {}

  async deleteMe(userId: string, password: string) {
    const passwordHash = await this.loadPasswordHash(userId);

    // 400, nunca 401: o interceptor do front desloga em 401 e o usuario
    // perderia a sessao so por errar a senha.
    const passwordMatches = await bcrypt.compare(password, passwordHash);
    if (!passwordMatches) {
      throw new BadRequestException("Senha incorreta.");
    }

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      message: "Conta e dados pessoais excluidos com sucesso.",
      deletedAt: new Date().toISOString(),
    };
  }

  private async loadPasswordHash(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }
    return user.passwordHash;
  }
}
