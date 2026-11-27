import { UsersService } from "./users.service";

describe("createUser - escrita dentro da transacao", () => {
  it("usuario e cartao Principal vao pelo cliente da transacao, nao pelo prisma global", async () => {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: "u-new" }) },
      creditCard: { create: jest.fn().mockResolvedValue({}) },
    };
    const createMany = { createMany: jest.fn().mockResolvedValue({}) };
    const prisma: any = {
      user: { create: jest.fn() },
      creditCard: { create: jest.fn() },
      taskCategory: createMany,
      financeCategory: createMany,
      tagGroup: createMany,
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    const service = new UsersService(prisma, { get: jest.fn() } as any);
    jest.spyOn(service, "findById").mockResolvedValue({ id: "u-new" } as any);

    await service.createUser({ name: "Ana", email: "a@a.com", passwordHash: "h" } as any);

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.creditCard.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "u-new" }) });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.creditCard.create).not.toHaveBeenCalled();
    expect(createMany.createMany).toHaveBeenCalledTimes(3);
  });
});
