import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { LoginDto } from "./login.dto";
import { RegisterDto } from "./register.dto";
import { ResetPasswordDto } from "./reset-password.dto";

describe("regras de senha", () => {
  const passwordErrors = async (cls: any, password: unknown) => {
    const dto = plainToInstance(cls, {
      email: "a@b.com",
      name: "Fulano",
      id: "11111111-1111-4111-8111-111111111111",
      token: "t".repeat(32),
      privacyNoticeAccepted: true,
      password,
    });
    const errors = await validate(dto as object);
    return errors.filter((e) => e.property === "password").flatMap((e) => Object.values(e.constraints ?? {}));
  };

  describe.each([
    ["cadastro", RegisterDto],
    ["redefinicao", ResetPasswordDto],
  ])("%s (senha nova)", (_name, cls) => {
    it("exige 8 caracteres", async () => {
      expect((await passwordErrors(cls, "Abc1234"))[0]).toMatch(/minimo 8 caracteres/);
      expect(await passwordErrors(cls, "Xk7mPq2w")).toEqual([]);
    });

    it("recusa senhas comuns, sem diferenciar maiuscula", async () => {
      expect(await passwordErrors(cls, "12345678")).toContain("Essa senha e muito comum ou repetitiva. Escolha outra.");
      expect(await passwordErrors(cls, "PassWord123")).not.toEqual([]); // "password123" com outra caixa
      expect(await passwordErrors(cls, "SENHA123")).not.toEqual([]);
      expect(await passwordErrors(cls, "Xk7mPq2w")).toEqual([]);
    });

    it("recusa repeticao (aaaaaaaa, abababab)", async () => {
      expect(await passwordErrors(cls, "aaaaaaaa")).not.toEqual([]);
      expect(await passwordErrors(cls, "abababab")).not.toEqual([]);
      expect(await passwordErrors(cls, "abcabcab")).toEqual([]);
    });

    it("teto de 72 (o bcrypt truncaria o resto em silencio)", async () => {
      expect(await passwordErrors(cls, "aB1".repeat(24))).toEqual([]);
      expect((await passwordErrors(cls, "aB1".repeat(24) + "x"))[0]).toMatch(/maximo 72/);
    });
  });

  describe("login (nao pode trancar quem ja tem senha antiga)", () => {
    it("continua aceitando 6 e 7 caracteres", async () => {
      expect(await passwordErrors(LoginDto, "abc123")).toEqual([]);
      expect(await passwordErrors(LoginDto, "abc1234")).toEqual([]);
    });

    it("aceita senha longa (cadastrada antes do teto de 72) e recusa so o absurdo", async () => {
      expect(await passwordErrors(LoginDto, "x".repeat(200))).toEqual([]);
      expect(await passwordErrors(LoginDto, "x".repeat(1025))).not.toEqual([]);
      expect(await passwordErrors(LoginDto, "abc12")).not.toEqual([]);
    });
  });
});
