import { ConfigService } from '@nestjs/config';
import { readBootstrapSettings } from './bootstrap-settings';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('readBootstrapSettings', () => {
  it('usa porta 3000 e host 0.0.0.0 por padrao', () => {
    const settings = readBootstrapSettings(configWith({}));

    expect(settings.port).toBe(3000);
    expect(settings.host).toBe('0.0.0.0');
  });

  it('deriva appUrl da porta, sem CORS e sem Swagger por padrao', () => {
    const settings = readBootstrapSettings(configWith({ 'app.port': 4100 }));

    expect(settings.appUrl).toBe('http://localhost:4100');
    expect(settings.corsAllowedOrigins).toEqual([]);
    expect(settings.swaggerEnabled).toBe(false);
  });

  it('respeita valores configurados', () => {
    const settings = readBootstrapSettings(
      configWith({
        'app.port': 8080,
        'app.host': '10.0.0.1',
        'app.appUrl': 'https://api.exemplo.com',
        'app.corsAllowedOrigins': ['https://app.exemplo.com'],
        'app.swaggerEnabled': true,
      }),
    );

    expect(settings).toEqual({
      port: 8080,
      host: '10.0.0.1',
      appUrl: 'https://api.exemplo.com',
      corsAllowedOrigins: ['https://app.exemplo.com'],
      swaggerEnabled: true,
    });
  });
});
