import { randomUUID } from "crypto";
import { ConfigService } from "@nestjs/config";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { JwtPayload } from "../../common/interfaces/jwt-payload.interface";
import { IssueTokensInput } from "./session.types";

export function tokenPayload(input: IssueTokensInput, sessionId: string): JwtPayload {
  return { sub: input.userId, email: input.email, role: input.role, sessionId };
}

/** Assina o access token e o refresh token (com jwtid proprio) do mesmo payload. */
export async function signTokenPair(
  config: ConfigService,
  jwt: JwtService,
  payload: JwtPayload,
  refreshExpiresIn: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessSecret = config.getOrThrow<string>("auth.accessSecret");
  const refreshSecret = config.getOrThrow<string>("auth.refreshSecret");
  const accessExpiresIn = config.get<string>("auth.accessExpiresIn") ?? "15m";

  const [accessToken, refreshToken] = await Promise.all([
    jwt.signAsync(payload, {
      secret: accessSecret,
      // O tipo do @nestjs/jwt 11 exige "number | StringValue" (ex.: "15m"); o valor vem da env.
      expiresIn: accessExpiresIn as JwtSignOptions["expiresIn"],
    }),
    jwt.signAsync(payload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn as JwtSignOptions["expiresIn"],
      // Sem isso, dois refresh no mesmo segundo geram o MESMO token (payload e iat
      // iguais) e a rotacao deixa de distinguir o novo do antigo.
      jwtid: randomUUID(),
    }),
  ]);
  return { accessToken, refreshToken };
}
