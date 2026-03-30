import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.privacyNoticeAccepted) {
      throw new BadRequestException(
        "E necessario aceitar o aviso de privacidade para criar a conta.",
      );
    }

    const normalizedEmail = dto.email.toLowerCase().trim();
    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new BadRequestException("Ja existe uma conta com este email.");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.createUser({
      name: dto.name,
      email: normalizedEmail,
      passwordHash,
      avatarUrl: dto.avatarUrl,
      preferredCurrency: dto.preferredCurrency ?? "BRL",
      monthlyIncome: dto.monthlyIncome,
      monthClosingDay: dto.monthClosingDay ?? 30,
      timezone: dto.timezone ?? "America/Sao_Paulo",
      privacyNoticeAccepted: dto.privacyNoticeAccepted,
      aiAssistantEnabled: dto.aiAssistantEnabled ?? false,
    });

    this.logger.log(`register_success userId=${user.id} email=${user.email}`);
    return this.issueTokens(user.id, user.email, user.role, user);
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      throw new UnauthorizedException("Credenciais invalidas.");
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("Credenciais invalidas.");
    }

    await this.usersService.updateLastLogin(user.id);
    this.logger.log(`login_success userId=${user.id} email=${user.email}`);
    return this.issueTokens(user.id, user.email, user.role, user);
  }

  async refresh(dto: RefreshDto) {
    const refreshSecret =
      this.configService.get<string>("auth.refreshSecret") ??
      "lumen_refresh_secret";
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(
        dto.refreshToken,
        {
          secret: refreshSecret,
        },
      );
    } catch (error) {
      throw new UnauthorizedException("Refresh token invalido.");
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user.refreshTokenHash) {
      throw new UnauthorizedException("Refresh token expirado.");
    }

    const isValidRefreshToken = await bcrypt.compare(
      dto.refreshToken,
      user.refreshTokenHash,
    );

    if (!isValidRefreshToken) {
      throw new UnauthorizedException("Refresh token invalido.");
    }

    return this.issueTokens(user.id, user.email, user.role, user);
  }

  async me(userId: string) {
    const user = await this.usersService.findById(userId);
    return this.usersService.sanitizeUser(user);
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    user: Awaited<ReturnType<UsersService["findById"]>>,
  ) {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
    };

    const accessSecret =
      this.configService.get<string>("auth.accessSecret") ??
      "lumen_access_secret";
    const refreshSecret =
      this.configService.get<string>("auth.refreshSecret") ??
      "lumen_refresh_secret";
    const accessExpiresIn =
      this.configService.get<string>("auth.accessExpiresIn") ?? "15m";
    const refreshExpiresIn =
      this.configService.get<string>("auth.refreshExpiresIn") ?? "7d";

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      }),
    ]);

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.usersService.updateRefreshToken(userId, refreshTokenHash);

    return {
      accessToken,
      refreshToken,
      user: await this.usersService.sanitizeUser(user),
    };
  }
}
