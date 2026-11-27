import { Response } from "express";
import { RequestWithContext } from "../common/interfaces/request-with-context.interface";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RefreshCookieService } from "./session/refresh-cookie.service";

describe("AuthController cookie de refresh", () => {
  const request = {} as RequestWithContext;
  const response = {} as Response;
  const user = { sub: "user-1", sessionId: "session-1" } as never;
  const refreshCookie = { attach: jest.fn(), clear: jest.fn(), shouldUse: jest.fn() };
  const authService: Record<string, jest.Mock> = { refresh: jest.fn(), logout: jest.fn(), logoutAll: jest.fn() };
  const controller = new AuthController(
    authService as unknown as AuthService,
    refreshCookie as unknown as RefreshCookieService,
  );

  beforeEach(() => jest.resetAllMocks());

  it.each([["register"], ["login"]] as const)("%s devolve o que o servico de cookie entregar", async (action) => {
    const authResponse = { accessToken: "a", refreshToken: "r" };
    authService[action] = jest.fn().mockResolvedValue(authResponse);
    refreshCookie.attach.mockReturnValue({ accessToken: "a" });

    const result = await controller[action]({} as never, request, response);

    expect(authService[action]).toHaveBeenCalledWith({}, request);
    expect(refreshCookie.attach).toHaveBeenCalledWith(authResponse, request, response);
    expect(result).toEqual({ accessToken: "a" });
  });

  it("refresh entrega a resposta ja tratada pelo servico de cookie", async () => {
    authService.refresh.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
    refreshCookie.attach.mockReturnValue({ accessToken: "a" });

    await expect(controller.refresh({ refreshToken: "r" }, request, response)).resolves.toEqual({ accessToken: "a" });
    expect(refreshCookie.clear).not.toHaveBeenCalled();
  });

  it("refresh que falha em cliente web limpa o cookie e repassa o erro", async () => {
    const failure = new Error("expirado");
    authService.refresh.mockRejectedValue(failure);
    refreshCookie.shouldUse.mockReturnValue(true);

    await expect(controller.refresh({}, request, response)).rejects.toBe(failure);
    expect(refreshCookie.clear).toHaveBeenCalledWith(response);
  });

  it("refresh que falha fora da web nao mexe no cookie", async () => {
    authService.refresh.mockRejectedValue(new Error("expirado"));
    refreshCookie.shouldUse.mockReturnValue(false);

    await expect(controller.refresh({}, request, response)).rejects.toThrow("expirado");
    expect(refreshCookie.clear).not.toHaveBeenCalled();
  });

  it("logout e logout-all sempre limpam o cookie e chamam o servico", async () => {
    authService.logout.mockResolvedValue("ok-1");
    authService.logoutAll.mockResolvedValue("ok-2");

    await expect(controller.logout(user, response)).resolves.toBe("ok-1");
    await expect(controller.logoutAll(user, response)).resolves.toBe("ok-2");

    expect(refreshCookie.clear).toHaveBeenCalledTimes(2);
    expect(authService.logout).toHaveBeenCalledWith("user-1", "session-1");
    expect(authService.logoutAll).toHaveBeenCalledWith("user-1");
  });
});
