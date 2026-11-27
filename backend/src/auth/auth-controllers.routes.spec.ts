import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { AuthController } from "./auth.controller";
import { AuthEmailController } from "./auth-email.controller";
import { AuthMfaController } from "./auth-mfa.controller";

type Route = [handler: string, method: RequestMethod, path: string, isPublic: boolean];

const EXPECTED: Route[] = [
  ["register", RequestMethod.POST, "register", true],
  ["login", RequestMethod.POST, "login", true],
  ["refresh", RequestMethod.POST, "refresh", true],
  ["logout", RequestMethod.POST, "logout", false],
  ["logoutAll", RequestMethod.POST, "logout-all", false],
  ["me", RequestMethod.GET, "me", false],
  ["forgotPassword", RequestMethod.POST, "forgot-password", true],
  ["resetPassword", RequestMethod.POST, "reset-password", true],
  ["verifyEmail", RequestMethod.POST, "verify-email", true],
  ["resendVerification", RequestMethod.POST, "resend-verification", false],
  ["verifyLoginMfa", RequestMethod.POST, "mfa/verify-login", true],
  ["requestEmailMfaBypass", RequestMethod.POST, "mfa/email-bypass/request", true],
  ["verifyEmailMfaBypass", RequestMethod.POST, "mfa/email-bypass/verify", true],
  ["startMfaSetup", RequestMethod.POST, "mfa/setup", false],
  ["confirmMfaSetup", RequestMethod.POST, "mfa/confirm-setup", false],
  ["regenerateRecoveryCodes", RequestMethod.POST, "mfa/recovery-codes/regenerate", false],
  ["disableMfa", RequestMethod.POST, "mfa/disable", false],
];

const describeRoutes = (controller: { prototype: object }): Route[] => {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .map((name) => {
      const handler = proto[name] as object;
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
      return [name, Reflect.getMetadata(METHOD_METADATA, handler), Reflect.getMetadata(PATH_METADATA, handler), isPublic] as Route;
    });
};

describe("rotas dos controllers de auth", () => {
  const controllers = [AuthController, AuthMfaController, AuthEmailController];

  it("expoe exatamente as 17 rotas com metodo, caminho e visibilidade publica", () => {
    const actual = controllers.flatMap(describeRoutes);

    expect(actual).toHaveLength(17);
    expect(actual).toEqual(expect.arrayContaining(EXPECTED));
  });

  it.each(controllers)("monta %p sob o prefixo auth", (controller) => {
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe("auth");
  });
});
