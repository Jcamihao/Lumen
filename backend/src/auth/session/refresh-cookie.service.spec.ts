import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { RefreshCookieService } from "./refresh-cookie.service";
import { AuthTokensResponse, MfaChallengeResponse } from "./session.types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const COOKIE_NAME = "lumen_refresh";

describe("RefreshCookieService", () => {
  const user = { id: "user-1" } as AuthTokensResponse["user"];
  const tokens: AuthTokensResponse = { accessToken: "access-1", refreshToken: "refresh-1", user };
  const mfaChallenge: MfaChallengeResponse = { requiresMfa: true, challengeId: "c-1", challengeExpiresAt: "2026-11-26T12:00:00.000Z", availableMethods: ["totp"] };

  const buildConfig = (values: Record<string, unknown> = {}) => {
    const configValues = { "auth.refreshCookieName": COOKIE_NAME, ...values };
    return {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
  };

  const buildRequest = (platform?: string) =>
    ({
      header: (name: string) => (name === "x-lumen-client-platform" ? platform : undefined),
    }) as unknown as RequestWithContext;

  const buildResponse = () => {
    const fake = { cookie: jest.fn(), clearCookie: jest.fn() };
    return { fake, response: fake as unknown as Response };
  };

  const attach = (authResponse: AuthTokensResponse | MfaChallengeResponse, platform?: string, config = buildConfig()) => {
    const { fake, response } = buildResponse();
    const result = new RefreshCookieService(config).attach(authResponse, buildRequest(platform), response);
    return { result, fake };
  };

  it("grava o cookie com as opcoes configuradas para web e devolve sem refreshToken", () => {
    const config = buildConfig({
      "auth.refreshCookieSecure": true,
      "auth.refreshCookieSameSite": "strict",
      "auth.refreshCookieDomain": ".lumen.test",
      "auth.refreshCookiePath": "/api/v1/auth",
      "auth.refreshExpiresIn": "12h",
    });

    const { result, fake } = attach(tokens, "web", config);

    expect(fake.cookie).toHaveBeenCalledWith(COOKIE_NAME, "refresh-1", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      domain: ".lumen.test",
      path: "/api/v1/auth",
      maxAge: 12 * 60 * 60 * 1_000,
    });
    expect(result).toEqual({ accessToken: "access-1", user });
    expect(result).not.toHaveProperty("refreshToken");
  });

  it.each([["mobile"], [undefined]])("devolve a resposta inteira sem cookie para plataforma %s", (platform) => {
    const { result, fake } = attach(tokens, platform);

    expect(result).toBe(tokens);
    expect(fake.cookie).not.toHaveBeenCalled();
  });

  it("passa direto a resposta de desafio MFA mesmo para web", () => {
    const { result, fake } = attach(mfaChallenge, "web");

    expect(result).toBe(mfaChallenge);
    expect(fake.cookie).not.toHaveBeenCalled();
  });

  it("considera web o header com espacos e maiusculas", () => {
    const { result, fake } = attach(tokens, "  WEB ");

    expect(fake.cookie).toHaveBeenCalledWith(COOKIE_NAME, "refresh-1", expect.any(Object));
    expect(result).not.toHaveProperty("refreshToken");
  });

  it("usa 7 dias de maxAge quando a duracao configurada e invalida", () => {
    const { fake } = attach(tokens, "web", buildConfig({ "auth.refreshExpiresIn": "abc" }));

    expect(fake.cookie).toHaveBeenCalledWith(COOKIE_NAME, "refresh-1", expect.objectContaining({ maxAge: SEVEN_DAYS_MS }));
  });

  it("limpa o cookie com as mesmas opcoes e sem maxAge", () => {
    const config = buildConfig({
      "auth.refreshCookieSecure": true,
      "auth.refreshCookieSameSite": "none",
      "auth.refreshCookieDomain": ".lumen.test",
    });
    const { fake, response } = buildResponse();

    new RefreshCookieService(config).clear(response);

    expect(fake.clearCookie).toHaveBeenCalledWith(COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      domain: ".lumen.test",
      path: "/api/v1/auth",
    });
    expect(fake.clearCookie.mock.calls[0][1]).not.toHaveProperty("maxAge");
  });

  it("usa os defaults quando nada esta configurado", () => {
    const { fake } = attach(tokens, "web");

    expect(fake.cookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      "refresh-1",
      expect.objectContaining({ secure: false, sameSite: "lax", path: "/api/v1/auth", maxAge: SEVEN_DAYS_MS }),
    );
  });
});
