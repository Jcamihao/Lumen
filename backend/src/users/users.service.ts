import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { AccountDeleter } from "./account/account-deleter";
import { AccountUpdater } from "./account/account-updater";
import { UpdateUserDto } from "./dto/update-user.dto";
import { sanitizePublicUser } from "./profile/sanitize-user";
import { UserExporter } from "./export/user-exporter";
import { CreateUserInput } from "./registration/create-user.input";
import { UserRegistrar } from "./registration/user-registrar";

@Injectable()
export class UsersService {
  private readonly exporter: UserExporter;
  private readonly registrar: UserRegistrar;
  private readonly accountUpdater: AccountUpdater;
  private readonly accountDeleter: AccountDeleter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.exporter = new UserExporter(prisma, () => this.isMfaFeatureEnabled());
    this.registrar = new UserRegistrar(prisma);
    this.accountUpdater = new AccountUpdater(prisma);
    this.accountDeleter = new AccountDeleter(prisma);
  }

  async createUser(input: CreateUserInput) {
    const user = await this.registrar.createAccount(input);
    await this.registrar.seedDefaults(user.id);
    return this.findById(user.id);
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        taskCategories: true,
        financeCategories: true,
        tagGroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        taskCategories: {
          orderBy: { name: "asc" },
        },
        financeCategories: {
          orderBy: { name: "asc" },
        },
        tagGroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Usuario nao encontrado.");
    }

    return user;
  }

  async getMe(userId: string) {
    const user = await this.findById(userId);
    return this.sanitizeUser(user);
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    await this.accountUpdater.updateMe(userId, dto);
    return this.getMe(userId);
  }

  async updatePassword(userId: string, passwordHash: string) {
    return this.accountUpdater.updatePassword(userId, passwordHash);
  }

  async markEmailVerified(userId: string) {
    return this.accountUpdater.markEmailVerified(userId);
  }

  async updateLastLogin(userId: string) {
    return this.accountUpdater.updateLastLogin(userId);
  }

  async exportMe(userId: string) {
    return this.exporter.exportMe(userId);
  }

  async deleteMe(userId: string, password: string) {
    return this.accountDeleter.deleteMe(userId, password);
  }

  async sanitizeUser(user: Awaited<ReturnType<UsersService["findById"]>>) {
    return sanitizePublicUser(user, this.isMfaFeatureEnabled());
  }

  private isMfaFeatureEnabled() {
    return this.configService.get<boolean>("auth.mfaEnabled") ?? false;
  }
}
