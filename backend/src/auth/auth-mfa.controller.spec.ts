import { Response } from "express";
import { RequestWithContext } from "../common/interfaces/request-with-context.interface";
import { AuthMfaController } from "./auth-mfa.controller";
import { AuthService } from "./auth.service";
import { RefreshCookieService } from "./session/refresh-cookie.service";

describe("AuthMfaController cookie de refresh", () => {
  const request = {} as RequestWithContext;
  const response = {} as Response;
  const authService = { verifyLoginMfa: jest.fn(), verifyEmailMfaBypass: jest.fn() };
  const refreshCookie = { attach: jest.fn() };
  const controller = new AuthMfaController(
    authService as unknown as AuthService,
    refreshCookie as unknown as RefreshCookieService,
  );

  beforeEach(() => jest.resetAllMocks());

  it.each([["verifyLoginMfa"], ["verifyEmailMfaBypass"]] as const)("%s devolve o que o servico de cookie entregar", async (action) => {
    const authResponse = { accessToken: "a", refreshToken: "r" };
    authService[action].mockResolvedValue(authResponse);
    refreshCookie.attach.mockReturnValue({ accessToken: "a" });

    const result = await controller[action]({} as never, request, response);

    expect(authService[action]).toHaveBeenCalledWith({}, request);
    expect(refreshCookie.attach).toHaveBeenCalledWith(authResponse, request, response);
    expect(result).toEqual({ accessToken: "a" });
  });
});
