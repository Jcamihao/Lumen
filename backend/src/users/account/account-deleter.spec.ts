import * as bcrypt from "bcryptjs";
import { AccountDeleter } from "./account-deleter";

describe("AccountDeleter - escopo por usuario", () => {
  it("busca a senha e apaga somente o usuario autenticado", async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ passwordHash: bcrypt.hashSync("ok", 4) }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    await new AccountDeleter(prisma).deleteMe("u-1", "ok");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u-1" },
      select: { passwordHash: true },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u-1" } });
  });
});
