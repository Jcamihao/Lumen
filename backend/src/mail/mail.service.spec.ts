import { MailService } from "./mail.service";

describe("MailService", () => {
  const buildConfigService = (overrides: Record<string, unknown> = {}) =>
    ({
      get: jest.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          "app.appUrl": "http://localhost:3000",
          "mail.enabled": true,
          "mail.apiKey": "re_test_123",
          "mail.baseUrl": "https://api.resend.com",
          "mail.fromEmail": "noreply@lumen.local",
          "mail.fromName": "LUMEN",
          "mail.replyTo": "",
          "mail.timeoutMs": 8000,
        };

        return overrides[key] ?? defaults[key];
      }),
    }) as any;

  it("skips dispatch when Resend is disabled", async () => {
    const service = new MailService(
      buildConfigService({
        "mail.enabled": false,
      }),
    );
    const postSpy = jest.spyOn(service as any, "postJson");

    const result = await service.sendEmail({
      to: "marina@exemplo.com",
      subject: "Teste",
      text: "Hello",
    });

    expect(result.skipped).toBe(true);
    expect(result.message).toContain("desabilitado");
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("builds a Resend request with headers and tags", async () => {
    const service = new MailService(buildConfigService());
    const postSpy = jest.spyOn(service as any, "postJson").mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
      }),
    });

    const result = await service.sendEmail({
      to: ["marina@exemplo.com", "time@exemplo.com"],
      subject: "Lembrete",
      text: "Seu lembrete chegou.",
      html: "<p>Seu lembrete chegou.</p>",
      tags: ["reminder", "lumen"],
      replyTo: "ajuda@lumen.local",
    });

    const [url, apiKey, body, timeoutMs] = postSpy.mock.calls[0];
    const payload = JSON.parse(String(body));

    expect(url).toBe("https://api.resend.com/emails");
    expect(apiKey).toBe("re_test_123");
    expect(timeoutMs).toBe(8000);
    expect(payload).toEqual(
      expect.objectContaining({
        from: "LUMEN <noreply@lumen.local>",
        to: ["marina@exemplo.com", "time@exemplo.com"],
        subject: "Lembrete",
        text: "Seu lembrete chegou.",
        html: "<p>Seu lembrete chegou.</p>",
        headers: {
          "Reply-To": "ajuda@lumen.local",
        },
        tags: expect.arrayContaining([
          { name: "reminder", value: "true" },
          { name: "lumen", value: "true" },
        ]),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.message).toBe("Email aceito pelo Resend.");
  });

  it("creates a welcome email with the app link", async () => {
    const service = new MailService(buildConfigService());
    const sendSpy = jest.spyOn(service, "sendEmail").mockResolvedValue({
      provider: "resend",
      skipped: false,
      message: "Email aceito pelo Resend.",
    });

    await service.sendWelcomeEmail({
      email: "marina@exemplo.com",
      name: "Marina Costa",
    });

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "marina@exemplo.com",
        subject: "Sua conta no LUMEN esta pronta",
        text: expect.stringContaining("http://localhost:3000"),
        html: expect.stringContaining("http://localhost:3000"),
      }),
    );
  });
});
