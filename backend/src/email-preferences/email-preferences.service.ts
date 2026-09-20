import { createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import type { UnsubscribeLinks } from "../mail/mail.service";
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_FIELD,
  EmailCategory,
} from "./email-categories";

@Injectable()
export class EmailPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Token de descadastro sem estado e sem expiracao: um link antigo de
   * email precisa continuar funcionando. Assinado com HMAC, escopado a uma
   * categoria — nao serve para nada alem de desligar aquela categoria.
   */
  signToken(userId: string, category: EmailCategory) {
    const payload = Buffer.from(`${userId}.${category}`).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token: string | undefined | null) {
    const [payload, signature, ...rest] = String(token ?? "").split(".");

    if (!payload || !signature || rest.length > 0) {
      return null;
    }

    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }

    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const separatorIndex = decoded.lastIndexOf(".");
    const userId = decoded.slice(0, separatorIndex);
    const category = decoded.slice(separatorIndex + 1) as EmailCategory;

    if (!userId || !EMAIL_CATEGORIES.includes(category)) {
      return null;
    }

    return { userId, category };
  }

  buildUnsubscribeLinks(userId: string, category: EmailCategory): UnsubscribeLinks {
    const token = encodeURIComponent(this.signToken(userId, category));
    const frontendUrl =
      this.configService.get<string>("app.frontendUrl") ??
      "http://localhost:4200";
    const appUrl =
      this.configService.get<string>("app.appUrl") ?? "http://localhost:3000";

    return {
      pageUrl: `${frontendUrl}/unsubscribe?token=${token}`,
      oneClickUrl: `${appUrl.replace(/\/+$/, "")}/api/v1/email-preferences/unsubscribe?token=${token}`,
    };
  }

  async unsubscribe(token: string | undefined | null) {
    const verified = this.verifyToken(token);

    if (!verified) {
      throw new BadRequestException("Link de descadastro invalido.");
    }

    // updateMany: usuario apagado nao vira erro, so no-op idempotente.
    await this.prisma.user.updateMany({
      where: { id: verified.userId },
      data: { [EMAIL_CATEGORY_FIELD[verified.category]]: false },
    });

    return { success: true, category: verified.category };
  }

  private sign(payload: string) {
    const secret =
      this.configService.getOrThrow<string>("auth.emailLinkSecret");
    return createHmac("sha256", secret)
      .update(`unsubscribe:${payload}`)
      .digest("base64url");
  }
}
