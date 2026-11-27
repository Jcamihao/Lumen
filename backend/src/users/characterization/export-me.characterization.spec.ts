import { UsersService } from "../users.service";
import { buildExportFixture, FIXED_NOW } from "./export-user.fixture";

describe("exportMe - caracterizacao da exportacao LGPD", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  });
  afterEach(() => jest.useRealTimers());

  const exportFor = async (mfaEnabled: boolean, overrides: Record<string, unknown> = {}) => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(buildExportFixture(overrides)) } };
    const config = { get: jest.fn((key: string) => (key === "auth.mfaEnabled" ? mfaEnabled : undefined)) };
    const service = new UsersService(prisma as any, config as any);
    const data = await service.exportMe("user-1");
    return { data, query: prisma.user.findUnique.mock.calls[0][0] };
  };

  it.each([true, false])("exporta tudo com mfa=%s (consulta, objeto e JSON na mesma ordem)", async (mfa) => {
    const { data, query } = await exportFor(mfa);

    expect(query).toMatchSnapshot();
    expect(data).toMatchSnapshot();
    expect(JSON.stringify(data)).toMatchSnapshot();
  });

  it("sem IA ativa: externalProcessing inativo e sem categorias", async () => {
    const { data } = await exportFor(true, { aiAssistantEnabled: false });

    expect(data).toMatchSnapshot();
  });

  it("consentimento de IA sem aceite do aviso nao conta como processamento ativo", async () => {
    const { data } = await exportFor(false, { privacyNoticeAcceptedAt: null });

    expect(data).toMatchSnapshot();
  });
});
