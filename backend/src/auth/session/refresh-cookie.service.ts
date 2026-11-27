import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CookieOptions, Response } from "express";
import { RequestWithContext } from "../../common/interfaces/request-with-context.interface";
import { parseDurationToMs } from "./duration";
import { AuthResponse, AuthResponseBody } from "./session.types";

const DEFAULT_REFRESH_EXPIRES_IN = "7d";
const DEFAULT_REFRESH_COOKIE_PATH = "/api/v1/auth";
const DEFAULT_REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Entrega o refresh token em cookie httpOnly para clientes web. */
@Injectable()
export class RefreshCookieService {
  constructor(private readonly config: ConfigService) {}

  shouldUse(request: RequestWithContext) {
    const clientPlatform = request.header("x-lumen-client-platform");
    return clientPlatform?.trim().toLowerCase() === "web";
  }

  attach(authResponse: AuthResponse, request: RequestWithContext, response: Response): AuthResponseBody {
    if (!("accessToken" in authResponse) || !this.shouldUse(request)) {
      return authResponse;
    }

    response.cookie(this.cookieName(), authResponse.refreshToken, {
      ...this.baseOptions(),
      maxAge: this.refreshMaxAgeMs(),
    });

    return { accessToken: authResponse.accessToken, user: authResponse.user };
  }

  clear(response: Response) {
    response.clearCookie(this.cookieName(), this.baseOptions());
  }

  private cookieName() {
    return this.config.getOrThrow<string>("auth.refreshCookieName");
  }

  private baseOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>("auth.refreshCookieSecure") ?? false,
      sameSite: this.config.get<"lax" | "strict" | "none">("auth.refreshCookieSameSite") ?? "lax",
      domain: this.config.get<string>("auth.refreshCookieDomain"),
      path: this.config.get<string>("auth.refreshCookiePath") ?? DEFAULT_REFRESH_COOKIE_PATH,
    };
  }

  private refreshMaxAgeMs() {
    const expiresIn = this.config.get<string>("auth.refreshExpiresIn") ?? DEFAULT_REFRESH_EXPIRES_IN;
    try {
      return parseDurationToMs(expiresIn);
    } catch {
      return DEFAULT_REFRESH_MAX_AGE_MS;
    }
  }
}
