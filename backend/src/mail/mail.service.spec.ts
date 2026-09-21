import { MailService } from "./mail.service";

describe("MailService", () => {
  const buildConfigService = (overrides: Record<string, unknown> = {}) =>
    ({
      get: jest.fn((key: string) => {
        const defaults: Record<string, unknown> = {
          "app.appUrl": "http://localhost:3000",
          "app.frontendUrl": "http://localhost:4200",
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

  const stubSend = (service: MailService) =>
    jest.spyOn(service, "sendEmail").mockResolvedValue({
      provider: "resend",
      skipped: false,
      message: "Email aceito pelo Resend.",
    });

  it("creates a welcome email linking to the frontend and the verification link", async () => {
    const service = new MailService(buildConfigService());
    const sendSpy = stubSend(service);

    await service.sendWelcomeEmail({
      email: "marina@exemplo.com",
      name: "Marina Costa",
      verifyUrl: "http://localhost:4200/auth/verify-email?id=abc&token=xyz",
    });

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "marina@exemplo.com",
        subject: "Sua conta no LUMEN esta pronta",
        text: expect.stringContaining("http://localhost:4200"),
        html: expect.stringContaining("Confirmar email"),
      }),
    );
    const [options] = sendSpy.mock.calls[0];
    expect(options.text).toContain("/auth/verify-email?id=abc&token=xyz");
    expect(options.text).not.toContain("http://localhost:3000");
  });

  it("sends the password reset link with its expiry and no unsubscribe headers", async () => {
    const service = new MailService(buildConfigService());
    const sendSpy = stubSend(service);

    await service.sendPasswordResetEmail({
      email: "marina@exemplo.com",
      name: "Marina Costa",
      resetUrl: "http://localhost:4200/auth/reset-password?id=abc&token=xyz",
      expiresInMinutes: 60,
    });

    const [options] = sendSpy.mock.calls[0];
    expect(options.subject).toBe("LUMEN: redefinir sua senha");
    expect(options.text).toContain("/auth/reset-password?id=abc&token=xyz");
    expect(options.text).toContain("60 minutos");
    expect(options.headers).toBeUndefined();
  });

  describe("automated emails carry unsubscribe links", () => {
    const unsubscribe = {
      pageUrl: "http://localhost:4200/unsubscribe?token=t",
      oneClickUrl: "http://localhost:3000/api/v1/email-preferences/unsubscribe?token=t",
    };

    it("adds the footer and the List-Unsubscribe headers to the weekly digest", async () => {
      const service = new MailService(buildConfigService());
      const sendSpy = stubSend(service);

      await service.sendWeeklyDigestEmail({
        email: "marina@exemplo.com",
        name: "Marina",
        preferredCurrency: "BRL",
        overdueTasksCount: 0,
        balance: 100,
        monthlyExpenses: 50,
        monthlyIncome: 200,
        goals: [],
        unsubscribe,
      });

      const [options] = sendSpy.mock.calls[0];
      expect(options.headers).toEqual({
        "List-Unsubscribe": `<${unsubscribe.oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
      expect(options.text).toContain(unsubscribe.pageUrl);
      expect(options.html).toContain("Deixar de receber");
    });

    it("adds them to reminders and insight escalations too", async () => {
      const service = new MailService(buildConfigService());
      const sendSpy = stubSend(service);

      await service.sendReminderEmail({
        email: "marina@exemplo.com",
        title: "Pagar energia",
        remindAt: new Date("2026-09-20T12:00:00.000Z"),
        unsubscribe,
      });
      await service.sendInsightEscalationEmail({
        email: "marina@exemplo.com",
        message: "Meta travada.",
        unsubscribe,
      });

      for (const [options] of sendSpy.mock.calls) {
        expect(options.headers?.["List-Unsubscribe"]).toBe(
          `<${unsubscribe.oneClickUrl}>`,
        );
        expect(options.html).toContain(unsubscribe.pageUrl);
      }
    });

    it("keeps the Reply-To header alongside List-Unsubscribe", async () => {
      const service = new MailService(
        buildConfigService({ "mail.replyTo": "ajuda@lumen.local" }),
      );
      const postSpy = jest
        .spyOn(service as any, "postJson")
        .mockResolvedValue({ statusCode: 200, body: JSON.stringify({ id: "1" }) });

      await service.sendReminderEmail({
        email: "marina@exemplo.com",
        title: "Pagar energia",
        remindAt: new Date("2026-09-20T12:00:00.000Z"),
        unsubscribe,
      });

      const payload = JSON.parse(String(postSpy.mock.calls[0][2]));
      expect(payload.headers).toEqual({
        "Reply-To": "ajuda@lumen.local",
        "List-Unsubscribe": `<${unsubscribe.oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
    });
  });

  describe("branded header", () => {
    it("puts the LUMEN logo, from the public frontend URL, at the top of every email", async () => {
      const frontendUrl = "https://financelumen.tech";
      const service = new MailService(
        buildConfigService({ "app.frontendUrl": frontendUrl }),
      );
      const sendSpy = stubSend(service);
      const person = { email: "marina@exemplo.com", name: "Marina" };

      await service.sendWelcomeEmail(person);
      await service.sendEmailVerificationEmail({
        ...person,
        verifyUrl: `${frontendUrl}/auth/verify-email?id=a&token=b`,
        expiresInHours: 48,
      });
      await service.sendPasswordResetEmail({
        ...person,
        resetUrl: `${frontendUrl}/auth/reset-password?id=a&token=b`,
        expiresInMinutes: 60,
      });
      await service.sendPasswordChangedEmail(person);
      await service.sendReminderEmail({
        ...person,
        title: "Pagar energia",
        remindAt: new Date("2026-09-20T12:00:00.000Z"),
      });
      await service.sendInsightEscalationEmail({
        ...person,
        message: "Meta travada.",
      });
      await service.sendWeeklyDigestEmail({
        ...person,
        preferredCurrency: "BRL",
        overdueTasksCount: 0,
        balance: 100,
        monthlyExpenses: 50,
        monthlyIncome: 200,
        goals: [],
      });
      await service.sendMfaBypassEmail({ ...person, otp: "123456" });

      expect(sendSpy).toHaveBeenCalledTimes(8);
      for (const [options] of sendSpy.mock.calls) {
        const html = String(options.html);
        expect(html).toContain(
          `src="${frontendUrl}/assets/logo/logo_lumen_1024.png"`,
        );
        expect(html).toContain('alt="LUMEN"');
        expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<p>"));
        expect(String(options.text)).not.toContain("<img");
      }
    });
  });
});
