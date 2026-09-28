import { asaasConfig } from './asaas.config';

describe('asaasConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('usa os padroes quando as variaveis nao estao definidas', () => {
    delete process.env.ASAAS_API_KEY;
    delete process.env.ASAAS_BASE_URL;
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    delete process.env.ASAAS_TIMEOUT_MS;

    const config = asaasConfig();

    expect(config.apiKey).toBe('');
    expect(config.baseUrl).toBe('https://api-sandbox.asaas.com/v3');
    expect(config.webhookToken).toBe('');
    expect(config.timeoutMs).toBe(10000);
  });

  it('le cada variavel quando definida', () => {
    process.env.ASAAS_API_KEY = 'asaas-key-123';
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3/';
    process.env.ASAAS_WEBHOOK_TOKEN = 'webhook-token-abc';
    process.env.ASAAS_TIMEOUT_MS = '5000';

    const config = asaasConfig();

    expect(config.apiKey).toBe('asaas-key-123');
    expect(config.baseUrl).toBe('https://api.asaas.com/v3');
    expect(config.webhookToken).toBe('webhook-token-abc');
    expect(config.timeoutMs).toBe(5000);
  });
});
