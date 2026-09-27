import { appConfig } from './app.config';

describe('appConfig.billingEnabled', () => {
  const original = process.env.BILLING_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BILLING_ENABLED;
    } else {
      process.env.BILLING_ENABLED = original;
    }
  });

  function setEnv(value: string | undefined) {
    if (value === undefined) {
      delete process.env.BILLING_ENABLED;
    } else {
      process.env.BILLING_ENABLED = value;
    }
  }

  it.each(['true', '1', 'YES', 'on'])('liga com %p', (value) => {
    setEnv(value);
    expect(appConfig().billingEnabled).toBe(true);
  });

  it.each([undefined, '', 'false', 'talvez', '0'])(
    'fica desligado com %p',
    (value) => {
      setEnv(value);
      expect(appConfig().billingEnabled).toBe(false);
    },
  );
});
