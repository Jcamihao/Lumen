import { BadRequestException } from "@nestjs/common";
import { canSendAutomatedEmail } from "./email-categories";
import { EmailPreferencesService } from "./email-preferences.service";

describe("EmailPreferencesService", () => {
  const buildService = () => {
    const prisma = { user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const values: Record<string, string> = {
      "auth.emailLinkSecret": "segredo-de-teste",
      "app.frontendUrl": "https://financelumen.tech",
      "app.appUrl": "https://api.financelumen.tech/",
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    return { service: new EmailPreferencesService(prisma as any, config as any), prisma };
  };

  it("round-trips a signed token", () => {
    const { service } = buildService();
    const token = service.signToken("user-1", "weekly_digest");

    expect(service.verifyToken(token)).toEqual({ userId: "user-1", category: "weekly_digest" });
  });

  it("rejects tampered, foreign-signed and malformed tokens", () => {
    const { service } = buildService();
    const [payload, signature] = service.signToken("user-1", "reminders").split(".");
    const otherCategory = Buffer.from("user-1.weekly_digest").toString("base64url");
    const otherUser = Buffer.from("user-2.reminders").toString("base64url");

    expect(service.verifyToken(`${otherCategory}.${signature}`)).toBeNull();
    expect(service.verifyToken(`${otherUser}.${signature}`)).toBeNull();
    expect(service.verifyToken(`${payload}.${signature}x`)).toBeNull();
    expect(service.verifyToken(`${payload}`)).toBeNull();
    expect(service.verifyToken("")).toBeNull();
    expect(service.verifyToken(undefined)).toBeNull();
  });

  it("does not accept a token signed with a different secret", () => {
    const first = buildService().service;
    const second = buildService().service;
    (second as any).configService.getOrThrow = jest.fn(() => "outro-segredo");

    expect(second.verifyToken(first.signToken("user-1", "reminders"))).toBeNull();
  });

  it("turns off only the category carried by the token", async () => {
    const { service, prisma } = buildService();

    const result = await service.unsubscribe(service.signToken("user-1", "insight_alerts"));

    expect(result).toEqual({ success: true, category: "insight_alerts" });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailInsightAlerts: false },
    });
  });

  it("turns off the bill_due category through its own switch", async () => {
    const { service, prisma } = buildService();

    const result = await service.unsubscribe(service.signToken("user-1", "bill_due"));

    expect(result).toEqual({ success: true, category: "bill_due" });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailBillReminders: false },
    });
  });

  it("refuses an invalid token without touching the database", async () => {
    const { service, prisma } = buildService();

    await expect(service.unsubscribe("lixo.lixo")).rejects.toThrow(BadRequestException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("builds a frontend page link and an API one-click link", () => {
    const { service } = buildService();
    const links = service.buildUnsubscribeLinks("user-1", "reminders");

    expect(links.pageUrl).toMatch(/^https:\/\/financelumen\.tech\/unsubscribe\?token=/);
    expect(links.oneClickUrl).toMatch(
      /^https:\/\/api\.financelumen\.tech\/api\/v1\/email-preferences\/unsubscribe\?token=/,
    );
    const token = decodeURIComponent(links.pageUrl.split("token=")[1]);
    expect(service.verifyToken(token)).toEqual({ userId: "user-1", category: "reminders" });
  });
});

describe("canSendAutomatedEmail", () => {
  const verified = new Date();

  it("blocks unverified emails and unknown users", () => {
    expect(canSendAutomatedEmail({ emailVerifiedAt: null }, "reminders")).toBe(false);
    expect(canSendAutomatedEmail(null, "reminders")).toBe(false);
  });

  it("allows verified users by default", () => {
    expect(canSendAutomatedEmail({ emailVerifiedAt: verified }, "weekly_digest")).toBe(true);
  });

  it("respects the per-category switch and leaves the others alone", () => {
    const user = { emailVerifiedAt: verified, emailWeeklyDigest: false };

    expect(canSendAutomatedEmail(user, "weekly_digest")).toBe(false);
    expect(canSendAutomatedEmail(user, "reminders")).toBe(true);
    expect(canSendAutomatedEmail(user, "insight_alerts")).toBe(true);
  });

  it("gates bill_due on a verified email and on its own switch", () => {
    expect(canSendAutomatedEmail({ emailVerifiedAt: null }, "bill_due")).toBe(false);
    expect(canSendAutomatedEmail({ emailVerifiedAt: verified }, "bill_due")).toBe(true);
    expect(
      canSendAutomatedEmail({ emailVerifiedAt: verified, emailBillReminders: false }, "bill_due"),
    ).toBe(false);
    expect(
      canSendAutomatedEmail({ emailVerifiedAt: verified, emailInsightAlerts: false }, "bill_due"),
    ).toBe(true);
  });
});
